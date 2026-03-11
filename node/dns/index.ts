import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const NODE_ID = Deno.env.get("NODE_ID")!;
const DNS_PORT = parseInt(Deno.env.get("DNS_PORT") ?? "53");
const DNS_BIND = Deno.env.get("DNS_BIND") ?? "10.10.0.1";
const UPSTREAM_PRIMARY = Deno.env.get("DNS_UPSTREAM_PRIMARY") ?? "1.1.1.1";
const UPSTREAM_SECONDARY = Deno.env.get("DNS_UPSTREAM_SECONDARY") ?? "8.8.8.8";
const UPSTREAM_PORT = 53;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_SIZE = 1000;
const CONFIG_POLL_MS = 60_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface CacheEntry { response: Uint8Array; expires: number; }
interface DnsConfig { blockedDomains: Set<string>; filteringEnabled: boolean; }

const cache = new Map<string, CacheEntry>();

function cacheKey(domain: string, qtype: number): string { return `${domain}:${qtype}`; }

function cacheGet(domain: string, qtype: number): Uint8Array | null {
  const entry = cache.get(cacheKey(domain, qtype));
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(cacheKey(domain, qtype)); return null; }
  return entry.response;
}

function cacheSet(domain: string, qtype: number, response: Uint8Array, ttlMs = CACHE_TTL_MS) {
  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey(domain, qtype), { response, expires: Date.now() + ttlMs });
}

let dnsConfig: DnsConfig = { blockedDomains: new Set(), filteringEnabled: false };

async function loadDnsConfig() {
  try {
    const { error } = await supabase.from("nodes").select("id").eq("id", NODE_ID).maybeSingle();
    if (error) { console.error("[dns-config] error:", error.message); return; }
    dnsConfig = { blockedDomains: new Set(), filteringEnabled: false };
    console.log(`[dns-config] loaded — filtering=${dnsConfig.filteringEnabled}`);
  } catch (e) { console.error("[dns-config] exception:", (e as Error).message); }
}

function parseDnsQuestion(buf: Uint8Array): { domain: string; qtype: number; id: number } | null {
  try {
    if (buf.length < 12) return null;
    const id = (buf[0] << 8) | buf[1];
    let offset = 12;
    const labels: string[] = [];
    while (offset < buf.length) {
      const len = buf[offset];
      if (len === 0) { offset++; break; }
      if (offset + 1 + len > buf.length) return null;
      labels.push(new TextDecoder().decode(buf.slice(offset + 1, offset + 1 + len)));
      offset += 1 + len;
    }
    const domain = labels.join(".");
    if (offset + 4 > buf.length) return null;
    const qtype = (buf[offset] << 8) | buf[offset + 1];
    return { domain, qtype, id };
  } catch (_e) { return null; }
}

function buildNxdomainResponse(queryBuf: Uint8Array): Uint8Array {
  const response = new Uint8Array(queryBuf.length);
  response.set(queryBuf);
  response[2] = 0x81;
  response[3] = 0x83;
  return response;
}

async function forwardToUpstream(query: Uint8Array, upstream: string): Promise<Uint8Array | null> {
  try {
    const ts = Date.now();
    const tmpIn = `/tmp/dns_q_${ts}.bin`;
    const tmpOut = `/tmp/dns_r_${ts}.bin`;
    await Deno.writeFile(tmpIn, query);
    const p = new Deno.Command("bash", {
      args: ["-c", `socat -t3 - UDP:${upstream}:${UPSTREAM_PORT} < ${tmpIn} > ${tmpOut} 2>/dev/null`],
      stdout: "null", stderr: "null",
    });
    const { code } = await p.output();
    let response: Uint8Array | null = null;
    if (code === 0) {
      try { response = await Deno.readFile(tmpOut); } catch (_e) { response = null; }
    }
    await Deno.remove(tmpIn).catch((_e) => {});
    await Deno.remove(tmpOut).catch((_e) => {});
    return response && response.length > 0 ? response : null;
  } catch (_e) { return null; }
}

async function resolve(query: Uint8Array): Promise<Uint8Array | null> {
  let response = await forwardToUpstream(query, UPSTREAM_PRIMARY);
  if (response) return response;
  console.warn(`[dns] primary failed, trying secondary`);
  return await forwardToUpstream(query, UPSTREAM_SECONDARY);
}

async function handleQuery(data: Uint8Array, remoteAddr: Deno.Addr, server: Deno.DatagramConn) {
  const parsed = parseDnsQuestion(data);
  if (!parsed) return;
  const { domain, qtype, id } = parsed;

  if (dnsConfig.filteringEnabled && dnsConfig.blockedDomains.has(domain)) {
    console.log(`[dns] BLOCKED ${domain}`);
    await server.send(buildNxdomainResponse(data), remoteAddr);
    return;
  }

  const cached = cacheGet(domain, qtype);
  if (cached) {
    const response = new Uint8Array(cached);
    response[0] = (id >> 8) & 0xff;
    response[1] = id & 0xff;
    await server.send(response, remoteAddr);
    return;
  }

  const response = await resolve(data);
  if (!response) {
    console.error(`[dns] failed to resolve ${domain}`);
    await server.send(buildNxdomainResponse(data), remoteAddr);
    return;
  }

  cacheSet(domain, qtype, response);
  await server.send(response, remoteAddr);
}

console.log(`[dns] SafeSwitch DNS engine starting — bind=${DNS_BIND}:${DNS_PORT}`);
await loadDnsConfig();
setInterval(loadDnsConfig, CONFIG_POLL_MS);

const server = Deno.listenDatagram({ transport: "udp", hostname: DNS_BIND, port: DNS_PORT });
console.log(`[dns] listening on ${DNS_BIND}:${DNS_PORT} ✓`);
console.log(`[dns] upstream primary=${UPSTREAM_PRIMARY} secondary=${UPSTREAM_SECONDARY}`);

for await (const [data, remoteAddr] of server) {
  handleQuery(data, remoteAddr, server).catch((e: Error) => console.error("[dns] handler error:", e.message));
}
