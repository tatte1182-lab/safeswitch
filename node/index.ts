import { createClient, type RealtimeChannel } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const NODE_ID = requiredEnv("NODE_ID");

const WG_INTERFACE = Deno.env.get("WG_INTERFACE") ?? "wg0";
const WG_PORT = Number.parseInt(Deno.env.get("WG_PORT") ?? "51820", 10);
const BLOCKLIST_DIR = Deno.env.get("BLOCKLIST_DIR") ?? "/etc/safeswitch";
const BLOCKLIST_PATH = `${BLOCKLIST_DIR}/blocklist.conf`;
const DNS_SERVICE = Deno.env.get("DNS_SERVICE") ?? "ss-dns";
const HEARTBEAT_INTERVAL_MS = 30_000;
const RESYNC_INTERVAL_MS = 5 * 60_000;
const RELAY_STALE_THRESHOLD_MS = 3 * 60_000;
const PAUSE_CHAIN = Deno.env.get("SAFESWITCH_PAUSE_CHAIN") ?? "SAFESWITCH_PAUSE";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let FAMILY_ID = "";
const bannerChannels = new Map<string, RealtimeChannel>();
let bootstrappedPauseChain = false;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCidr(ipOrCidr: string | null | undefined): string | null {
  if (!ipOrCidr) return null;
  return ipOrCidr.split("/")[0]?.trim() || null;
}

async function run(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr).trim() || `Command failed: ${cmd.join(" ")}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

async function runSilent(cmd: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const out = await run(cmd);
    return { ok: true, out };
  } catch (err: unknown) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

async function getPublicIp(): Promise<string> {
  try {
    const r = await fetch("https://api4.my-ip.io/ip", { signal: AbortSignal.timeout(5000) });
    return (await r.text()).trim();
  } catch {
    return "";
  }
}

async function getWgPublicKey(): Promise<string> {
  try {
    return await run(["wg", "show", WG_INTERFACE, "public-key"]);
  } catch {
    return "";
  }
}

async function getWgHandshakes(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const out = await run(["wg", "show", WG_INTERFACE, "latest-handshakes"]);
    for (const line of out.split("\n")) {
      const [key, ts] = line.trim().split(/\s+/);
      if (!key || !ts) continue;
      const parsed = Number.parseInt(ts, 10);
      if (Number.isFinite(parsed)) map.set(key, parsed * 1000);
    }
  } catch {
    // interface not up yet
  }
  return map;
}

async function checkRelayFallbacks() {
  const { data: devices, error } = await supabase
    .from("devices")
    .select("id, wireguard_public_key, display_name")
    .eq("assigned_node_id", NODE_ID)
    .eq("trust_state", "enrolled");

  if (error || !devices?.length) return;

  const handshakes = await getWgHandshakes();
  const now = Date.now();

  for (const device of devices) {
    if (!device.wireguard_public_key) continue;

    const lastHandshake = handshakes.get(device.wireguard_public_key) ?? 0;
    const age = now - lastHandshake;
    const isStale = lastHandshake === 0 || age > RELAY_STALE_THRESHOLD_MS;

    if (isStale) {
      console.log(
        `[relay-stub] device ${device.display_name ?? device.id} stale ` +
          `(${lastHandshake === 0 ? "never" : `${Math.round(age / 1000)}s ago`}) — relay not yet activated`,
      );
    } else {
      console.log(
        `[relay-stub] device ${device.display_name ?? device.id} healthy ` +
          `(handshake ${Math.round(age / 1000)}s ago)`,
      );
    }
  }
}

type DevicePeer = {
  id: string;
  wireguard_public_key: string | null;
  wireguard_ip: string | null;
};

async function listDesiredPeers(): Promise<DevicePeer[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, wireguard_public_key, wireguard_ip")
    .eq("assigned_node_id", NODE_ID)
    .eq("trust_state", "enrolled");

  if (error) throw error;
  return (data ?? []) as DevicePeer[];
}

async function listCurrentPeerKeys(): Promise<Set<string>> {
  const out = await runSilent(["wg", "show", WG_INTERFACE, "peers"]);
  if (!out.ok) return new Set<string>();
  return new Set(
    out.out
      .split(/\s+/)
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

async function syncPeers() {
  try {
    const devices = await listDesiredPeers();
    const desired = devices.filter((d) => d.wireguard_public_key && d.wireguard_ip) as Array<{
      id: string;
      wireguard_public_key: string;
      wireguard_ip: string;
    }>;

    const desiredKeys = new Set(desired.map((d) => d.wireguard_public_key));
    const currentKeys = await listCurrentPeerKeys();

    for (const key of currentKeys) {
      if (!desiredKeys.has(key)) {
        const res = await runSilent(["wg", "set", WG_INTERFACE, "peer", key, "remove"]);
        if (!res.ok) console.warn(`[peer-sync] failed removing stale peer ${key}: ${res.out}`);
        else console.log(`[peer-sync] removed stale peer ${key}`);
      }
    }

    for (const device of desired) {
      const allowedIp = stripCidr(device.wireguard_ip);
      if (!allowedIp) continue;
      await run([
        "wg",
        "set",
        WG_INTERFACE,
        "peer",
        device.wireguard_public_key,
        "allowed-ips",
        `${allowedIp}/32`,
      ]);
    }

    console.log(`[peer-sync] reconciled ${desired.length} active peer(s)`);
  } catch (err) {
    console.error("[peer-sync] sync error:", err instanceof Error ? err.message : String(err));
  }
}

async function markNodeActive() {
  const public_ip = await getPublicIp();
  const wireguard_public_key = await getWgPublicKey();
  const wireguard_endpoint = public_ip ? `${public_ip}:${WG_PORT}` : null;

  const { data: node, error: nodeErr } = await supabase
    .from("nodes")
    .select("family_id")
    .eq("id", NODE_ID)
    .single();

  if (nodeErr) {
    console.error("[boot] could not load node family:", nodeErr.message);
  } else if (node?.family_id) {
    FAMILY_ID = node.family_id;
  }

  const { error } = await supabase
    .from("nodes")
    .update({
      status: "active",
      public_ip,
      wireguard_public_key: wireguard_public_key || null,
      wireguard_endpoint,
      wireguard_port: WG_PORT,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", NODE_ID);

  if (error) console.error("[boot] markNodeActive error:", error.message);
  else console.log(`[boot] node active — ip=${public_ip} endpoint=${wireguard_endpoint}`);
}

async function markNodeOffline() {
  const { error } = await supabase
    .from("nodes")
    .update({ status: "offline", last_seen_at: new Date().toISOString() })
    .eq("id", NODE_ID);

  if (error) console.error("[shutdown] markNodeOffline error:", error.message);
  else console.log("[shutdown] node marked offline");
}

async function heartbeat() {
  const nowIso = new Date().toISOString();

  // Update node status
  const { error } = await supabase
    .from("nodes")
    .update({ last_seen_at: nowIso, status: "active" })
    .eq("id", NODE_ID);

  if (error) console.error("[heartbeat] error:", error.message);
  else console.log("[heartbeat] ✓", nowIso);

  // Upsert node_heartbeats — single row per node, always latest
  const hbPayload: Record<string, unknown> = {
    node_id:          NODE_ID,
    family_id:        FAMILY_ID,
    public_ip:        Deno.env.get("PUBLIC_IP") ?? Deno.env.get("NODE_PUBLIC_IP") ?? null,
    endpoint:         `${Deno.env.get("PUBLIC_IP") ?? ""}:${WG_PORT}`,
    tunnel_status:    "active",
    dns_status:       "active",
    software_version: "4a",
    pinged_at:        nowIso,
    created_at:       nowIso,
  };

  const { error: hbErr } = await supabase
    .from("node_heartbeats")
    .upsert(hbPayload, { onConflict: "node_id" });

  if (hbErr) console.error("[heartbeat] node_heartbeats upsert failed:", JSON.stringify(hbErr));
  else console.log("[heartbeat] node_heartbeats ✓");

  await checkRelayFallbacks();
}

async function syncAllDnsProfiles() {
  if (!FAMILY_ID) {
    console.warn("[dns-sync] FAMILY_ID missing — skipping");
    return;
  }

  try {
    const { data: profiles, error } = await supabase.rpc("get_latest_dns_profile", {
      p_family_id: FAMILY_ID,
    });

    if (error) {
      console.error("[dns-sync] rpc failed:", error.message);
      return;
    }

    const allPatterns = new Set<string>();

    for (const profile of profiles ?? []) {
      if (profile.pause_dns_all) continue;
      for (const p of profile.blocked_patterns ?? []) allPatterns.add(String(p));
      for (const c of profile.blocked_categories ?? []) allPatterns.add(`category:${String(c)}`);
    }

    const lines = [
      "# SafeSwitch blocklist — auto-generated",
      `# Updated: ${new Date().toISOString()}`,
      "# Do not edit — changes will be overwritten",
      "",
      ...[...allPatterns].sort(),
    ];

    await Deno.mkdir(BLOCKLIST_DIR, { recursive: true });
    await Deno.writeTextFile(BLOCKLIST_PATH, `${lines.join("\n")}\n`);

    const reload = await runSilent(["systemctl", "reload", DNS_SERVICE]);
    if (!reload.ok) {
      const restart = await runSilent(["systemctl", "restart", DNS_SERVICE]);
      if (!restart.ok) {
        console.error("[dns-sync] DNS service reload/restart failed:", restart.out);
      } else {
        console.log(`[dns-sync] ${DNS_SERVICE} restarted — ${allPatterns.size} pattern(s)`);
      }
    } else {
      console.log(`[dns-sync] ${DNS_SERVICE} reloaded — ${allPatterns.size} pattern(s)`);
    }
  } catch (err) {
    console.error("[dns-sync] syncAllDnsProfiles error:", err instanceof Error ? err.message : String(err));
  }
}

async function ensurePauseChain() {
  if (bootstrappedPauseChain) return;

  const chainCheck = await runSilent(["iptables", "-S", PAUSE_CHAIN]);
  if (!chainCheck.ok) {
    const created = await runSilent(["iptables", "-N", PAUSE_CHAIN]);
    if (!created.ok && !created.out.includes("Chain already exists")) {
      throw new Error(`could not create ${PAUSE_CHAIN}: ${created.out}`);
    }
  }

  const jumpCheck = await runSilent(["iptables", "-C", "FORWARD", "-j", PAUSE_CHAIN]);
  if (!jumpCheck.ok) {
    const inserted = await runSilent(["iptables", "-I", "FORWARD", "1", "-j", PAUSE_CHAIN]);
    if (!inserted.ok) throw new Error(`could not attach ${PAUSE_CHAIN} to FORWARD: ${inserted.out}`);
  }

  bootstrappedPauseChain = true;
}

async function ensurePauseRule(direction: "-s" | "-d", ip: string) {
  const check = await runSilent(["iptables", "-C", PAUSE_CHAIN, direction, ip, "-j", "DROP"]);
  if (check.ok) return;
  const add = await runSilent(["iptables", "-A", PAUSE_CHAIN, direction, ip, "-j", "DROP"]);
  if (!add.ok) throw new Error(`iptables add failed for ${ip} ${direction}: ${add.out}`);
}

async function removePauseRule(direction: "-s" | "-d", ip: string) {
  while (true) {
    const check = await runSilent(["iptables", "-C", PAUSE_CHAIN, direction, ip, "-j", "DROP"]);
    if (!check.ok) break;
    const del = await runSilent(["iptables", "-D", PAUSE_CHAIN, direction, ip, "-j", "DROP"]);
    if (!del.ok) throw new Error(`iptables delete failed for ${ip} ${direction}: ${del.out}`);
  }
}

async function getDeviceWireguardIp(deviceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("devices")
    .select("wireguard_ip")
    .eq("id", deviceId)
    .maybeSingle();

  if (error) throw error;
  return data?.wireguard_ip ?? null;
}

async function applyPause(wireguardIp: string | null) {
  const ip = stripCidr(wireguardIp);
  if (!ip) {
    console.warn("[pause] no wireguard_ip — skipping");
    return;
  }

  await ensurePauseChain();
  await ensurePauseRule("-s", ip);
  await ensurePauseRule("-d", ip);
  console.log(`[pause] DROP active for ${ip}`);
}

async function removePause(wireguardIp: string | null) {
  const ip = stripCidr(wireguardIp);
  if (!ip) {
    console.warn("[unpause] no wireguard_ip — skipping");
    return;
  }

  await ensurePauseChain();
  await removePauseRule("-s", ip);
  await removePauseRule("-d", ip);
  console.log(`[unpause] DROP removed for ${ip}`);
}

async function rebuildPauseStateFromDb() {
  await ensurePauseChain();

  const flush = await runSilent(["iptables", "-F", PAUSE_CHAIN]);
  if (!flush.ok) throw new Error(`could not flush ${PAUSE_CHAIN}: ${flush.out}`);

  const { data, error } = await supabase
    .from("enforcement_sync_log")
    .select("device_id, sync_type, payload, created_at")
    .eq("node_id", NODE_ID)
    .in("sync_type", ["pause", "unpause"])
    .in("status", ["pending", "acked"])
    .order("created_at", { ascending: true });

  if (error) throw error;

  const effective = new Map<string, { sync_type: string; payload: Record<string, unknown> | null }>();
  for (const row of data ?? []) {
    if (!row.device_id) continue;
    effective.set(row.device_id, {
      sync_type: row.sync_type,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
    });
  }

  for (const [deviceId, row] of effective.entries()) {
    if (row.sync_type !== "pause") continue;
    const wgIp = stripCidr(typeof row.payload?.wireguard_ip === "string" ? row.payload.wireguard_ip : null)
      ?? stripCidr(await getDeviceWireguardIp(deviceId));
    if (!wgIp) continue;
    await ensurePauseRule("-s", wgIp);
    await ensurePauseRule("-d", wgIp);
  }

  console.log(`[pause] rebuilt ${effective.size} device state record(s)`);
}

async function getBannerChannel(deviceId: string): Promise<RealtimeChannel> {
  const existing = bannerChannels.get(deviceId);
  if (existing) return existing;

  const channel = supabase.channel(`device:${deviceId}`, {
    config: { broadcast: { self: false, ack: true } },
  });

  const status = await new Promise<string>((resolve) => {
    channel.subscribe((s) => resolve(s));
  });

  if (status !== "SUBSCRIBED") {
    await supabase.removeChannel(channel);
    throw new Error(`banner channel subscribe failed for device ${deviceId}: ${status}`);
  }

  bannerChannels.set(deviceId, channel);
  return channel;
}

async function forwardBanner(payload: Record<string, unknown>) {
  const action = payload.action === "clear" ? "clear" : "set";
  const device_id = typeof payload.device_id === "string" ? payload.device_id : "";

  if (!device_id) throw new Error("forwardBanner: device_id missing from payload");

  const event = action === "clear" ? "banner_clear" : "banner_set";
  const channel = await getBannerChannel(device_id);

  const response = await channel.send({
    type: "broadcast",
    event,
    payload: {
      device_id,
      banner_title: typeof payload.banner_title === "string" ? payload.banner_title : null,
      banner_body: typeof payload.banner_body === "string" ? payload.banner_body : null,
      banner_until: typeof payload.banner_until === "string" ? payload.banner_until : null,
      banner_source: typeof payload.banner_source === "string" ? payload.banner_source : null,
    },
  });

  if (response !== "ok") {
    throw new Error(`forwardBanner broadcast failed for ${device_id}: ${response}`);
  }

  console.log(`[banner] ${event} → device ${device_id}`);
}

async function applyRouteProfile(payload: Record<string, unknown>) {
  const deviceId = typeof payload.device_id === "string" ? payload.device_id : "";
  const allowedIps = typeof payload.allowed_ips === "string" ? payload.allowed_ips.trim() : "";
  const wireguardIp = typeof payload.wireguard_ip === "string" ? payload.wireguard_ip : null;

  if (!deviceId) throw new Error("applyRouteProfile: device_id missing");
  if (!allowedIps) throw new Error("applyRouteProfile: allowed_ips missing from payload");

  const resolvedWgIp = wireguardIp ?? await getDeviceWireguardIp(deviceId);
  if (!resolvedWgIp) throw new Error(`applyRouteProfile: no wireguard_ip for device ${deviceId}`);

  const { data: device, error } = await supabase
    .from("devices")
    .select("wireguard_public_key")
    .eq("id", deviceId)
    .maybeSingle();

  if (error) throw error;
  if (!device?.wireguard_public_key) {
    throw new Error(`applyRouteProfile: no public key for device ${deviceId}`);
  }

  await run([
    "wg",
    "set",
    WG_INTERFACE,
    "peer",
    device.wireguard_public_key,
    "allowed-ips",
    allowedIps,
  ]);

  console.log(`[route] device ${deviceId} → ${allowedIps} (${String(payload.route_mode ?? "unknown")})`);
}

async function handleEnforcementSync(record: Record<string, unknown>) {
  const syncId = String(record.id ?? "");
  const syncType = String(record.sync_type ?? "");
  const deviceId = typeof record.device_id === "string" ? record.device_id : "";
  const payload = (record.payload as Record<string, unknown> | null) ?? {};

  console.log(`[enforcement] sync ${syncId} type=${syncType}`);

  let success = true;
  let errorMsg: string | null = null;

  try {
    switch (syncType) {
      case "dns_profile":
        await syncAllDnsProfiles();
        break;
      case "pause": {
        const wgIp = typeof payload.wireguard_ip === "string"
          ? payload.wireguard_ip
          : await getDeviceWireguardIp(deviceId);
        await applyPause(wgIp);
        break;
      }
      case "unpause": {
        const wgIp = typeof payload.wireguard_ip === "string"
          ? payload.wireguard_ip
          : await getDeviceWireguardIp(deviceId);
        await removePause(wgIp);
        break;
      }
      case "route_profile":
        await applyRouteProfile(payload);
        break;
      case "state_banner":
        await forwardBanner(payload);
        break;
      default:
        console.warn(`[enforcement] unknown sync_type: ${syncType} — skipping`);
    }
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[enforcement] sync ${syncId} failed:`, errorMsg);
  }

  if (success) {
    const { error: ackErr } = await supabase.rpc("ack_enforcement_command", {
      p_sync_id: syncId,
      p_result: { node_id: NODE_ID, completed_at: new Date().toISOString() },
    });
    if (ackErr) console.error(`[enforcement] ack failed for ${syncId}:`, ackErr.message);
  } else {
    const { error: failErr } = await supabase.rpc("fail_enforcement_command", {
      p_sync_id: syncId,
      p_error_message: errorMsg,
      p_result: { node_id: NODE_ID, failed_at: new Date().toISOString() },
    });
    if (failErr) console.error(`[enforcement] fail rpc error for ${syncId}:`, failErr.message);
  }
}

async function processPendingSyncs() {
  const { data: pending, error } = await supabase
    .from("enforcement_sync_log")
    .select("*")
    .eq("node_id", NODE_ID)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[enforcement] pending sync load failed:", error.message);
    return;
  }
  if (!pending?.length) {
    console.log("[enforcement] no pending syncs on boot");
    return;
  }

  console.log(`[enforcement] replaying ${pending.length} pending sync(s)`);
  for (const record of pending) {
    await handleEnforcementSync(record as Record<string, unknown>);
  }
}

function subscribeToDeviceChanges() {
  supabase
    .channel(`devices-changes:${NODE_ID}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "devices",
        filter: `assigned_node_id=eq.${NODE_ID}`,
      },
      () => {
        void syncPeers();
      },
    )
    .subscribe((status) => console.log("[realtime] devices:", status));
}

function subscribeEnforcementSync() {
  supabase
    .channel(`enforcement-sync:${NODE_ID}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "enforcement_sync_log",
        filter: `node_id=eq.${NODE_ID}`,
      },
      (payload) => {
        void handleEnforcementSync(payload.new as Record<string, unknown>);
      },
    )
    .subscribe((status) => console.log("[realtime] enforcement_sync_log:", status));
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[shutdown] caught signal, cleaning up...");

  for (const channel of bannerChannels.values()) {
    await supabase.removeChannel(channel).catch(() => undefined);
  }
  bannerChannels.clear();

  await markNodeOffline();
  Deno.exit(0);
}

Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);

console.log(`[boot] SafeSwitch node-agent starting — NODE_ID=${NODE_ID}`);

await markNodeActive();
await ensurePauseChain();
await syncPeers();
await rebuildPauseStateFromDb();
await checkRelayFallbacks();
await syncAllDnsProfiles();
await processPendingSyncs();

subscribeToDeviceChanges();
subscribeEnforcementSync();

setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
setInterval(() => void syncPeers(), RESYNC_INTERVAL_MS);

console.log("[boot] node-agent running ✓");
