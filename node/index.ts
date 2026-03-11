import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const NODE_ID = Deno.env.get("NODE_ID")!;
const WG_INTERFACE = Deno.env.get("WG_INTERFACE") ?? "wg0";
const WG_PORT = parseInt(Deno.env.get("WG_PORT") ?? "51820");
const HEARTBEAT_INTERVAL_MS = 30_000;
const RESYNC_INTERVAL_MS = 5 * 60_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── helpers ──────────────────────────────────────────────────────────────────

async function run(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await p.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout).trim();
}

async function getPublicIp(): Promise<string> {
  try {
    const r = await fetch("https://api4.my-ip.io/ip");
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

// ── WireGuard peer sync ───────────────────────────────────────────────────────

async function syncPeers() {
  const { data: devices, error } = await supabase
    .from("devices")
    .select("id, wireguard_public_key, tunnel_ip")
    .eq("node_id", NODE_ID)
    .eq("status", "active");

  if (error) {
    console.error("[peer-sync] fetch error:", error.message);
    return;
  }

  if (!devices || devices.length === 0) {
    console.log("[peer-sync] no active devices");
    return;
  }

  // Build peer config blocks
  const peerBlocks = devices
    .filter((d) => d.wireguard_public_key && d.tunnel_ip)
    .map((d) =>
      `[Peer]\nPublicKey = ${d.wireguard_public_key}\nAllowedIPs = ${d.tunnel_ip}/32`
    )
    .join("\n\n");

  // Write to temp file and syncconf (no tunnel drop)
  const tmpPath = `/tmp/wg_peers_${Date.now()}.conf`;
  await Deno.writeTextFile(tmpPath, peerBlocks);

  try {
    await run(["wg", "addconf", WG_INTERFACE, tmpPath]);
    console.log(`[peer-sync] synced ${devices.length} peers`);
  } catch (e) {
    console.error("[peer-sync] wg addconf failed:", e.message);
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
  }
}

// ── node registration ─────────────────────────────────────────────────────────

async function markNodeActive() {
  const public_ip = await getPublicIp();
  const wireguard_public_key = await getWgPublicKey();
  const wireguard_endpoint = public_ip ? `${public_ip}:${WG_PORT}` : null;

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
  else console.log(`[boot] node marked active — ip=${public_ip} endpoint=${wireguard_endpoint}`);
}

async function markNodeOffline() {
  const { error } = await supabase
    .from("nodes")
    .update({ status: "offline", last_seen_at: new Date().toISOString() })
    .eq("id", NODE_ID);

  if (error) console.error("[shutdown] markNodeOffline error:", error.message);
  else console.log("[shutdown] node marked offline");
}

// ── heartbeat ─────────────────────────────────────────────────────────────────

async function heartbeat() {
  const { error } = await supabase
    .from("nodes")
    .update({ last_seen_at: new Date().toISOString(), status: "active" })
    .eq("id", NODE_ID);

  if (error) console.error("[heartbeat] error:", error.message);
  else console.log("[heartbeat] ✓", new Date().toISOString());
}

// ── realtime subscription ─────────────────────────────────────────────────────

function subscribeToDeviceChanges() {
  supabase
    .channel("devices-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "devices", filter: `node_id=eq.${NODE_ID}` },
      (payload) => {
        console.log("[realtime] device change detected:", payload.eventType);
        syncPeers();
      }
    )
    .subscribe((status) => {
      console.log("[realtime] subscription status:", status);
    });
}

// ── graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown() {
  console.log("[shutdown] caught signal, cleaning up...");
  await markNodeOffline();
  Deno.exit(0);
}

Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);

// ── main ──────────────────────────────────────────────────────────────────────

console.log(`[boot] SafeSwitch node-agent starting — NODE_ID=${NODE_ID}`);

await markNodeActive();
await syncPeers();
subscribeToDeviceChanges();

setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
setInterval(syncPeers, RESYNC_INTERVAL_MS);

console.log("[boot] node-agent running ✓");
