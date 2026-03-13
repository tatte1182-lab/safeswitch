// SafeSwitch · Edge Function · route-profile-sync
// Phase 4a — corrected drop-in
//
// Routes:
//   POST /route-profile-sync/sync-child   { child_id, family_id }
//   POST /route-profile-sync/sync-device  { device_id, family_id }
//   POST /route-profile-sync/sync-family  { family_id }
//
// What it does:
//   Reads resolved_route_mode from child_effective_state and writes a
//   'route_profile' enforcement_sync_log entry per enrolled device.
//   The authoritative route target is:
//     device -> assigned_node_id -> resolved_route_mode -> computed_allowed_ips
//
// Current route mode contract:
//   full_tunnel    — AllowedIPs = 0.0.0.0/0, ::/0
//   split_tunnel   — AllowedIPs = 10.10.0.0/24
//                    (reserved SafeSwitch service subnet only for now)
//   service_only   — AllowedIPs = 10.10.0.1/32
//                    (single SafeSwitch service endpoint only for now)
//
// Notes:
// - This file intentionally does NOT claim family LAN subnets are included in
//   split_tunnel until that data is actually available and wired in.
// - If ROUTE_SYNC_INTERNAL_SECRET is set, requests must send:
//     x-internal-secret: <value>
//   If not set, no extra header auth is enforced.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const INTERNAL_SECRET = Deno.env.get("ROUTE_SYNC_INTERNAL_SECRET") ?? "";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function ensureInternalAuth(req: Request): Response | null {
  if (!INTERNAL_SECRET) return null;

  const given = req.headers.get("x-internal-secret") ?? "";
  if (given !== INTERNAL_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

// ── Route mode → AllowedIPs mapping ──────────────────────────

const ROUTE_MODE_ALLOWED_IPS: Record<string, string> = {
  full_tunnel: "0.0.0.0/0, ::/0",
  split_tunnel: "10.10.0.0/24",
  service_only: "10.10.0.1/32",
};

function allowedIpsForMode(mode: string): string {
  return ROUTE_MODE_ALLOWED_IPS[mode] ?? ROUTE_MODE_ALLOWED_IPS.full_tunnel;
}

function normalizeRouteMode(mode: string | null | undefined): string {
  if (!mode) return "full_tunnel";
  return ROUTE_MODE_ALLOWED_IPS[mode] ? mode : "full_tunnel";
}

function fingerprint(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Types ─────────────────────────────────────────────────────

type DeviceRouteRow = {
  family_id: string;
  child_id: string;
  device_id: string;
  wireguard_ip: string;
  assigned_node_id: string;
  resolved_route_mode: string;
};

type ActiveNode = {
  id: string;
  family_id: string;
  status: string;
};

type ChildRecord = {
  id: string;
  family_id: string;
};

type DeviceRecord = {
  id: string;
  child_id: string;
  trust_state: string;
  wireguard_ip: string | null;
  assigned_node_id: string | null;
};

type EffectiveStateRecord = {
  device_id: string;
  child_id: string;
  resolved_route_mode: string | null;
};

// ── Validation helpers ────────────────────────────────────────

async function getChildRecord(child_id: string): Promise<ChildRecord | null> {
  const { data, error } = await supabase
    .from("children")
    .select("id, family_id")
    .eq("id", child_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDeviceRecord(device_id: string): Promise<DeviceRecord | null> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, child_id, trust_state, wireguard_ip, assigned_node_id")
    .eq("id", device_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function assertChildBelongsToFamily(child_id: string, family_id: string): Promise<void> {
  const child = await getChildRecord(child_id);
  if (!child) throw new Error("Child not found");
  if (child.family_id !== family_id) {
    throw new Error("child_id does not belong to family_id");
  }
}

async function resolveFamilyIdForDevice(device_id: string): Promise<string | null> {
  const device = await getDeviceRecord(device_id);
  if (!device) return null;

  const child = await getChildRecord(device.child_id);
  return child?.family_id ?? null;
}

async function assertDeviceBelongsToFamily(device_id: string, family_id: string): Promise<void> {
  const resolvedFamilyId = await resolveFamilyIdForDevice(device_id);
  if (!resolvedFamilyId) throw new Error("Device not found");
  if (resolvedFamilyId !== family_id) {
    throw new Error("device_id does not belong to family_id");
  }
}

// ── Fetch helpers ─────────────────────────────────────────────

async function getChildEffectiveStates(child_id: string): Promise<EffectiveStateRecord[]> {
  const { data, error } = await supabase
    .from("child_effective_state")
    .select("device_id, child_id, resolved_route_mode")
    .eq("child_id", child_id);

  if (error) throw error;
  return data ?? [];
}

async function getDeviceEffectiveState(device_id: string): Promise<EffectiveStateRecord | null> {
  const { data, error } = await supabase
    .from("child_effective_state")
    .select("device_id, child_id, resolved_route_mode")
    .eq("device_id", device_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDeviceRoutesByChild(child_id: string, family_id: string): Promise<DeviceRouteRow[]> {
  const states = await getChildEffectiveStates(child_id);
  if (!states.length) return [];

  const deviceIds = states.map((s) => s.device_id);

  const { data: devices, error: devErr } = await supabase
    .from("devices")
    .select("id, child_id, trust_state, wireguard_ip, assigned_node_id")
    .in("id", deviceIds)
    .eq("child_id", child_id)
    .eq("trust_state", "enrolled")
    .not("wireguard_ip", "is", null)
    .not("assigned_node_id", "is", null);

  if (devErr) throw devErr;
  if (!devices?.length) return [];

  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  const rows: DeviceRouteRow[] = [];
  for (const state of states) {
    const device = deviceMap.get(state.device_id);
    if (!device?.wireguard_ip || !device.assigned_node_id) continue;

    rows.push({
      family_id,
      child_id: state.child_id,
      device_id: state.device_id,
      wireguard_ip: device.wireguard_ip,
      assigned_node_id: device.assigned_node_id,
      resolved_route_mode: normalizeRouteMode(state.resolved_route_mode),
    });
  }

  return rows;
}

async function getDeviceRoutesByFamily(family_id: string): Promise<DeviceRouteRow[]> {
  const { data: children, error: childErr } = await supabase
    .from("children")
    .select("id")
    .eq("family_id", family_id);

  if (childErr) throw childErr;
  if (!children?.length) return [];

  const childIds = children.map((c) => c.id);

  const { data: states, error: stateErr } = await supabase
    .from("child_effective_state")
    .select("device_id, child_id, resolved_route_mode")
    .in("child_id", childIds);

  if (stateErr) throw stateErr;
  if (!states?.length) return [];

  const deviceIds = states.map((s) => s.device_id);

  const { data: devices, error: devErr } = await supabase
    .from("devices")
    .select("id, child_id, trust_state, wireguard_ip, assigned_node_id")
    .in("id", deviceIds)
    .in("child_id", childIds)
    .eq("trust_state", "enrolled")
    .not("wireguard_ip", "is", null)
    .not("assigned_node_id", "is", null);

  if (devErr) throw devErr;
  if (!devices?.length) return [];

  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  const rows: DeviceRouteRow[] = [];
  for (const state of states) {
    const device = deviceMap.get(state.device_id);
    if (!device?.wireguard_ip || !device.assigned_node_id) continue;

    rows.push({
      family_id,
      child_id: state.child_id,
      device_id: state.device_id,
      wireguard_ip: device.wireguard_ip,
      assigned_node_id: device.assigned_node_id,
      resolved_route_mode: normalizeRouteMode(state.resolved_route_mode),
    });
  }

  return rows;
}

async function getDeviceRouteByDeviceId(device_id: string): Promise<DeviceRouteRow | null> {
  const state = await getDeviceEffectiveState(device_id);
  if (!state) return null;

  const device = await getDeviceRecord(device_id);
  if (
    !device ||
    device.trust_state !== "enrolled" ||
    !device.wireguard_ip ||
    !device.assigned_node_id
  ) {
    return null;
  }

  const child = await getChildRecord(device.child_id);
  if (!child) return null;

  return {
    family_id: child.family_id,
    child_id: state.child_id,
    device_id: state.device_id,
    wireguard_ip: device.wireguard_ip,
    assigned_node_id: device.assigned_node_id,
    resolved_route_mode: normalizeRouteMode(state.resolved_route_mode),
  };
}

// ── Core: write route_profile sync rows ──────────────────────

async function writeSyncRows(
  family_id: string,
  devices: DeviceRouteRow[],
  trigger_source: string,
): Promise<{ written: number; skipped: number }> {
  if (!devices.length) return { written: 0, skipped: 0 };

  const uniqueNodeIds = [...new Set(devices.map((d) => d.assigned_node_id))];

  const { data: activeNodes, error: nodeErr } = await supabase
    .from("nodes")
    .select("id, family_id, status")
    .in("id", uniqueNodeIds)
    .eq("family_id", family_id)
    .eq("status", "active");

  if (nodeErr) throw nodeErr;

  const activeNodeMap = new Map((activeNodes ?? []).map((n) => [n.id, n]));
  const nowIso = new Date().toISOString();

  const rows = [];
  let skipped = 0;

  for (const d of devices) {
    const node = activeNodeMap.get(d.assigned_node_id);
    if (!node) {
      console.warn(
        "[route-sync] skipping device due to missing/inactive assigned node",
        { family_id, device_id: d.device_id, assigned_node_id: d.assigned_node_id },
      );
      skipped++;
      continue;
    }

    const allowedIps = allowedIpsForMode(d.resolved_route_mode);
    const stateFingerprint = fingerprint(
      `${node.id}|${d.device_id}|${d.resolved_route_mode}|${allowedIps}|${d.wireguard_ip}`,
    );

    rows.push({
      family_id,
      node_id: node.id,
      child_id: d.child_id,
      device_id: d.device_id,
      sync_type: "route_profile",
      status: "pending",
      trigger_source,
      dedupe_key: `route_profile:${node.id}:${d.device_id}:${stateFingerprint}`,
      payload: {
        device_id: d.device_id,
        child_id: d.child_id,
        node_id: node.id,
        wireguard_ip: d.wireguard_ip,
        route_mode: d.resolved_route_mode,
        allowed_ips: allowedIps,
      },
      created_at: nowIso,
      available_at: nowIso,
    });
  }

  if (!rows.length) return { written: 0, skipped };

  const { error } = await supabase
    .from("enforcement_sync_log")
    .upsert(rows, { onConflict: "dedupe_key" });

  if (error) throw error;

  return { written: rows.length, skipped };
}

// ── Route handlers ────────────────────────────────────────────

async function handleSyncChild(body: { child_id?: string; family_id?: string }) {
  const child_id = body.child_id?.trim();
  const family_id = body.family_id?.trim();

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }

  await assertChildBelongsToFamily(child_id, family_id);

  const devices = await getDeviceRoutesByChild(child_id, family_id);
  const result = await writeSyncRows(family_id, devices, "route_sync_child");

  return json({
    ok: true,
    child_id,
    family_id,
    device_count: devices.length,
    ...result,
  });
}

async function handleSyncDevice(body: { device_id?: string; family_id?: string }) {
  const device_id = body.device_id?.trim();
  const family_id = body.family_id?.trim();

  if (!device_id || !family_id) {
    return json({ error: "device_id and family_id required" }, 400);
  }

  await assertDeviceBelongsToFamily(device_id, family_id);

  const device = await getDeviceRouteByDeviceId(device_id);
  if (!device) {
    return json({ error: "Device not found or not enrolled" }, 404);
  }

  if (device.family_id !== family_id) {
    return json({ error: "device_id does not belong to family_id" }, 400);
  }

  const result = await writeSyncRows(family_id, [device], "route_sync_device");

  return json({
    ok: true,
    device_id,
    family_id,
    ...result,
  });
}

async function handleSyncFamily(body: { family_id?: string }) {
  const family_id = body.family_id?.trim();
  if (!family_id) {
    return json({ error: "family_id required" }, 400);
  }

  const devices = await getDeviceRoutesByFamily(family_id);
  const result = await writeSyncRows(family_id, devices, "route_sync_family");

  return json({
    ok: true,
    family_id,
    device_count: devices.length,
    ...result,
  });
}

// ── Main ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authError = ensureInternalAuth(req);
  if (authError) return authError;

  const path = new URL(req.url).pathname.replace(/^\/route-profile-sync/, "");

  try {
    const body = await req.json();

    if (path === "/sync-child") return await handleSyncChild(body);
    if (path === "/sync-device") return await handleSyncDevice(body);
    if (path === "/sync-family") return await handleSyncFamily(body);

    return json({ error: "Unknown route" }, 400);
  } catch (err: any) {
    console.error("[route-profile-sync] error:", err);
    return json({ error: err?.message ?? "Internal error" }, 500);
  }
});
