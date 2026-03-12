import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const NODE_ID = Deno.env.get("NODE_ID")!;
const WG_INTERFACE = Deno.env.get("WG_INTERFACE") ?? "wg0";
const WG_PORT = parseInt(Deno.env.get("WG_PORT") ?? "51820");
const HEARTBEAT_INTERVAL_MS = 30_000;
const RESYNC_INTERVAL_MS = 5 * 60_000;

// ── relay fallback stub ───────────────────────────────────────────────────────
// 1b4: A device is considered stale if its WireGuard handshake is older than
// this threshold. In production this would trigger a real relay path.
// For now it stubs the detection and logs intent — relay infrastructure comes later.
const RELAY_STALE_THRESHOLD_MS = 3 * 60_000; // 3 minutes with no handshake

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Populated on boot from the nodes table
let FAMILY_ID = "";

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

// ── relay fallback stub ───────────────────────────────────────────────────────

// Returns a map of { publicKey -> lastHandshakeMs } from `wg show`
async function getWgHandshakes(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const out = await run(["wg", "show", WG_INTERFACE, "latest-handshakes"]);
    for (const line of out.split("\n")) {
      const [key, ts] = line.trim().split(/\s+/);
      if (key && ts) map.set(key, parseInt(ts) * 1000); // wg gives unix seconds
    }
  } catch {
    // wg not available or interface not up — skip silently
  }
  return map;
}

// Checks each active device for a stale handshake.
// If stale: logs relay intent and stubs a mesh_paths record.
// This is 1b4 — detection + schema stub only, not real relay routing.
async function checkRelayFallbacks() {
  const { data: devices, error } = await supabase
    .from("devices")
    .select("id, wireguard_public_key, wireguard_ip, display_name, child_id")
    .eq("assigned_node_id", NODE_ID)
    .eq("trust_state", "trusted");

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
        `[relay-stub] device ${device.display_name ?? device.id} has stale handshake ` +
        `(${lastHandshake === 0 ? "never" : `${Math.round(age / 1000)}s ago`}) — ` +
        `would activate relay path`
      );

      // Stub a mesh_paths record so the schema is exercised.
      // is_active = false — this is a candidate, not an active relay path.
      const { error: pathErr } = await supabase
        .from("mesh_paths")
        .upsert({
          device_id:     device.id,
          family_id:     FAMILY_ID || null,
          relay_node_id: NODE_ID,
          path_type:     "relay",
          is_active:     false,
          selected_at:   new Date().toISOString(),
        }, { onConflict: "device_id, relay_node_id", ignoreDuplicates: false });

      if (pathErr) {
        // mesh_paths schema may differ — log and continue, don't crash
        console.warn("[relay-stub] could not write mesh_path:", pathErr.message);
      }
    } else {
      console.log(
        `[relay-stub] device ${device.display_name ?? device.id} direct path healthy ` +
        `(handshake ${Math.round(age / 1000)}s ago)`
      );
    }
  }
}

// ── WireGuard peer sync ───────────────────────────────────────────────────────

async function syncPeers() {
  const { data: devices, error } = await supabase
    .from("devices")
    .select("id, wireguard_public_key, wireguard_ip")
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
    .filter((d) => d.wireguard_public_key && d.wireguard_ip)
    .map((d) =>
      `[Peer]\nPublicKey = ${d.wireguard_public_key}\nAllowedIPs = ${d.wireguard_ip}/32`
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

  // Fetch family_id so relay stubs can reference it
  const { data: node } = await supabase
    .from("nodes")
    .select("family_id")
    .eq("id", NODE_ID)
    .single();
  if (node?.family_id) FAMILY_ID = node.family_id;

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

  // 1b4: check relay fallback candidates on every heartbeat
  await checkRelayFallbacks();
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
await checkRelayFallbacks(); // 1b4: initial relay candidate scan
subscribeToDeviceChanges();

setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
setInterval(syncPeers, RESYNC_INTERVAL_MS);

console.log("[boot] node-agent running ✓");
