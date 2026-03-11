import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const NODE_ID = Deno.env.get("NODE_ID")!;
const DNS_PORT = parseInt(Deno.env.get("DNS_PORT") ?? "53");
const DNS_BIND = Deno.env.get("DNS_BIND") ?? "10.10.0.1"; // WireGuard interface IP

const UPSTREAM_PRIMARY = Deno.env.get("DNS_UPSTREAM_PRIMARY") ?? "1.1.1.1";
const UPSTREAM_SECONDARY = Deno.env.get("DNS_UPSTREAM_SECONDARY") ?? "8.8.8.8";
const UPSTREAM_PORT = 53;

const CACHE_TTL_MS = 30_000;       // 30s default cache
const CACHE_MAX_SIZE = 1000;
const CONFIG_POLL_MS = 60_000;     // re-fetch block list every 60s

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── types ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  response: Uint8Array;
  expires: number;
}

interface DnsConfig {
  blockedDomains: Set<string>;
  allowedDomains: Set<string>;
  filteringEnabled: boolean;
}

// ── cache ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

function cacheKey(domain: string, qtype: number): string {
  return `${domain}:${qtype}`;
}

function cacheGet(domain: string, qtype: number): Uint8Array | null {
  const entry = cache.get(cacheKey(domain, qtype));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(cacheKey(domain, qtype));
    return null;
  }
  return entry.response;
}

function cacheSet(domain: string, qtype: number, response: Uint8Array, ttlMs = CACHE_TTL_MS) {
  if (cache.size >= CACHE_MAX_SIZE) {
    // Evict oldest entry
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey(domain, qtype), { response, expires: Date.now() + ttlMs });
}

// ── DNS config from Supabase ──────────────────────────────────────────────────

let dnsConfig: DnsConfig = {
  blockedDomains: new Set(),
  allowedDomains: new Set(),
  filteringEnabled: false,
};

async function loadDnsConfig() {
  try {
    // Load node config / filter profile from Supabase
    // For now: stub — filtering will be populated by policy engine in Phase 3
    const { data, error } = await supabase
      .from("nodes")
      .select("id, status")
      .eq("id", NODE_ID)
      .maybeSingle();

    if (error) {
      console.error("[dns-config] load error:", error.message);
      return;
    }

    // Stub: no domains blocked yet — policy engine will push profiles here
    dnsConfig = {
      blockedDomains: new Set(),
      allowedDomains: new Set(),
      filteringEnabled: false,
    };

    console.log(`[dns-config] loaded — filtering=${dnsConfig.filteringEnabled} blocked=${dnsConfig.blockedDomains.size}`);
  } catch (e) {
    console.error("[dns-config] exception:", e.message);
  }
}

// ── DNS packet parsing ────────────────────────────────────────────────────────

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
  } catch {
    return null;
  }
}

function buildNxdomainResponse(queryBuf: Uint8Array): Uint8Array {
  // Copy the query, set QR=1, RCODE=3 (NXDOMAIN)
  const response = new Uint8Array(queryBuf.length);
  response.set(queryBuf);
  response[2] = 0x81; // QR=1, Opcode=0, AA=0, TC=0, RD=1
  response[3] = 0x83; // RA=1, RCODE=3 (NXDOMAIN)
  return response;
}

// ── upstream forwarding ───────────────────────────────────────────────────────

async function forwardToUpstream(
  query: Uint8Array,
  upstream: string,
  timeoutMs = 3000
): Promise<Uint8Array | null> {
  try {
    const conn = await Deno.connectDatagram({
      transport: "udp",
      hostname: upstream,
      port: UPSTREAM_PORT,
    });

    await conn.send(query, { transport: "udp", hostname: upstream, port: UPSTREAM_PORT });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const [data] = await Promise.race([
          conn.receive(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), deadline - Date.now())
          ),
        ]);
        conn.close();
        return data;
      } catch {
        break;
      }
    }

    conn.close();
    return null;
  } catch {
    return null;
  }
}

async function resolve(query: Uint8Array, domain: string, qtype: number): Promise<Uint8Array | null> {
  // Try primary upstream
  let response = await forwardToUpstream(query, UPSTREAM_PRIMARY);
  if (response) return response;

  // Fallback to secondary
  console.warn(`[dns] primary ${UPSTREAM_PRIMARY} failed, trying ${UPSTREAM_SECONDARY}`);
  response = await forwardToUpstream(query, UPSTREAM_SECONDARY);
  return response;
}

// ── request handler ───────────────────────────────────────────────────────────

async function handleQuery(data: Uint8Array, remoteAddr: Deno.Addr, server: Deno.DatagramConn) {
  const parsed = parseDnsQuestion(data);
  if (!parsed) return;

  const { domain, qtype, id } = parsed;

  // Check block list
  if (dnsConfig.filteringEnabled && dnsConfig.blockedDomains.has(domain)) {
    console.log(`[dns] BLOCKED ${domain} from ${JSON.stringify(remoteAddr)}`);
    const nxdomain = buildNxdomainResponse(data);
    await server.send(nxdomain, remoteAddr);
    return;
  }

  // Check cache
  const cached = cacheGet(domain, qtype);
  if (cached) {
    // Patch the ID to match this query
    const response = new Uint8Array(cached);
    response[0] = (id >> 8) & 0xff;
    response[1] = id & 0xff;
    await server.send(response, remoteAddr);
    return;
  }

  // Forward upstream
  const response = await resolve(data, domain, qtype);
  if (!response) {
    console.error(`[dns] failed to resolve ${domain}`);
    const nxdomain = buildNxdomainResponse(data);
    await server.send(nxdomain, remoteAddr);
    return;
  }

  // Cache and respond
  cacheSet(domain, qtype, response);
  await server.send(response, remoteAddr);
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log(`[dns] SafeSwitch DNS engine starting — bind=${DNS_BIND}:${DNS_PORT}`);

await loadDnsConfig();
setInterval(loadDnsConfig, CONFIG_POLL_MS);

const server = Deno.listenDatagram({
  transport: "udp",
  hostname: DNS_BIND,
  port: DNS_PORT,
});

console.log(`[dns] listening on ${DNS_BIND}:${DNS_PORT} ✓`);
console.log(`[dns] upstream primary=${UPSTREAM_PRIMARY} secondary=${UPSTREAM_SECONDARY}`);

for await (const [data, remoteAddr] of server) {
  handleQuery(data, remoteAddr, server).catch((e) =>
    console.error("[dns] handler error:", e.message)
  );
}
