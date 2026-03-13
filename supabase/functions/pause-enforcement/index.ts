// SafeSwitch · Edge Function · pause-enforcement
// Drop-in replacement
//
// Routes:
//   POST /pause-enforcement/pause    { child_id, family_id, duration_minutes? }
//   POST /pause-enforcement/unpause  { child_id, family_id }
//   POST /pause-enforcement/status   { child_id, family_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const POLICY_ENGINE_URL = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/policy-engine`;
const INTERNAL_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

async function recomputePolicy(child_id: string, trigger_source: string) {
  const res = await fetch(`${POLICY_ENGINE_URL}/compute-child`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${INTERNAL_KEY}`,
    },
    body: JSON.stringify({ child_id, trigger_source }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`policy-engine recompute failed: ${text}`);
  }

  return await res.json();
}

async function verifyFamilyAccess(
  child_id: string,
  family_id: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("children")
    .select("id")
    .eq("id", child_id)
    .eq("family_id", family_id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function getCurrentPauseProfile(child_id: string, family_id: string) {
  const { data, error } = await supabase
    .from("child_policy_profiles")
    .select("is_paused, paused_until")
    .eq("child_id", child_id)
    .eq("family_id", family_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

type EnrolledDevice = {
  id: string;
  wireguard_ip: string;
  assigned_node_id: string;
};

async function getEnrolledDevices(child_id: string): Promise<EnrolledDevice[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, wireguard_ip, assigned_node_id")
    .eq("child_id", child_id)
    .eq("trust_state", "enrolled")
    .not("assigned_node_id", "is", null)
    .not("wireguard_ip", "is", null);

  if (error) throw error;
  return (data ?? []) as EnrolledDevice[];
}

async function insertSyncRows(params: {
  family_id: string;
  child_id: string;
  sync_type: "pause" | "unpause";
  trigger_source: string;
  devices: EnrolledDevice[];
}) {
  const { family_id, child_id, sync_type, trigger_source, devices } = params;

  if (!devices.length) {
    return { inserted: 0 };
  }

  const nowIso = new Date().toISOString();

  const rows = devices.map((d) => ({
    family_id,
    node_id: d.assigned_node_id,
    child_id,
    device_id: d.id,
    sync_type,
    status: "pending",
    trigger_source,
    dedupe_key: `${sync_type}:${d.assigned_node_id}:${d.id}`,
    payload: {
      wireguard_ip: d.wireguard_ip,
      child_id,
      device_id: d.id,
      reason: trigger_source,
    },
    created_at: nowIso,
    available_at: nowIso,
  }));

  const { error } = await supabase
    .from("enforcement_sync_log")
    .upsert(rows, { onConflict: "dedupe_key" });

  if (error) throw error;

  return { inserted: rows.length };
}

async function handlePause(body: {
  child_id: string;
  family_id: string;
  duration_minutes?: number;
}) {
  const { child_id, family_id, duration_minutes } = body;

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }

  if (!await verifyFamilyAccess(child_id, family_id)) {
    return json({ error: "Child not found in family" }, 403);
  }

  const existing = await getCurrentPauseProfile(child_id, family_id);

  const paused_until =
    typeof duration_minutes === "number" && duration_minutes > 0
      ? new Date(Date.now() + duration_minutes * 60_000).toISOString()
      : null;

  const alreadyPaused =
    existing?.is_paused === true &&
    ((existing?.paused_until ?? null) === paused_until);

  if (!alreadyPaused) {
    const { error } = await supabase
      .from("child_policy_profiles")
      .update({
        is_paused: true,
        paused_until,
        updated_at: new Date().toISOString(),
      })
      .eq("child_id", child_id)
      .eq("family_id", family_id);

    if (error) {
      return json({ error: error.message }, 500);
    }
  }

  const recompute = await recomputePolicy(child_id, "parent_pause");
  const devices = await getEnrolledDevices(child_id);

  const syncResult = await insertSyncRows({
    family_id,
    child_id,
    sync_type: "pause",
    trigger_source: "parent_pause",
    devices,
  });

  return json({
    ok: true,
    child_id,
    paused: true,
    paused_until,
    idempotent: alreadyPaused,
    device_count: devices.length,
    sync_rows_written: syncResult.inserted,
    recompute,
  });
}

async function handleUnpause(body: {
  child_id: string;
  family_id: string;
}) {
  const { child_id, family_id } = body;

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }

  if (!await verifyFamilyAccess(child_id, family_id)) {
    return json({ error: "Child not found in family" }, 403);
  }

  const existing = await getCurrentPauseProfile(child_id, family_id);
  const alreadyUnpaused =
    !existing?.is_paused && existing?.paused_until == null;

  if (!alreadyUnpaused) {
    const { error } = await supabase
      .from("child_policy_profiles")
      .update({
        is_paused: false,
        paused_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("child_id", child_id)
      .eq("family_id", family_id);

    if (error) {
      return json({ error: error.message }, 500);
    }
  }

  const recompute = await recomputePolicy(child_id, "parent_unpause");
  const devices = await getEnrolledDevices(child_id);

  const syncResult = await insertSyncRows({
    family_id,
    child_id,
    sync_type: "unpause",
    trigger_source: "parent_unpause",
    devices,
  });

  return json({
    ok: true,
    child_id,
    paused: false,
    idempotent: alreadyUnpaused,
    device_count: devices.length,
    sync_rows_written: syncResult.inserted,
    recompute,
  });
}

async function handleStatus(body: {
  child_id: string;
  family_id: string;
}) {
  const { child_id, family_id } = body;

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }

  if (!await verifyFamilyAccess(child_id, family_id)) {
    return json({ error: "Child not found in family" }, 403);
  }

  const { data: profile, error: profileError } = await supabase
    .from("child_policy_profiles")
    .select("is_paused, paused_until, updated_at")
    .eq("child_id", child_id)
    .eq("family_id", family_id)
    .maybeSingle();

  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  const { data: effectiveStates, error: stateError } = await supabase
    .from("child_effective_state")
    .select(
      "device_id, internet_paused, state_summary, state_color, state_reason, next_state_change_at, last_computed_at",
    )
    .eq("child_id", child_id)
    .order("last_computed_at", { ascending: false });

  if (stateError) {
    return json({ error: stateError.message }, 500);
  }

  const { data: recentSyncs, error: syncError } = await supabase
    .from("enforcement_sync_log")
    .select(
      "id, node_id, device_id, sync_type, status, dedupe_key, created_at, acked_at, error_message",
    )
    .eq("child_id", child_id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (syncError) {
    return json({ error: syncError.message }, 500);
  }

  return json({
    ok: true,
    child_id,
    policy_paused: profile?.is_paused ?? false,
    paused_until: profile?.paused_until ?? null,
    profile_updated_at: profile?.updated_at ?? null,
    effective_states: effectiveStates ?? [],
    recent_syncs: recentSyncs ?? [],
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/pause-enforcement/, "");

  try {
    const body = await req.json();

    if (path === "/pause") return await handlePause(body);
    if (path === "/unpause") return await handleUnpause(body);
    if (path === "/status") return await handleStatus(body);

    return json({ error: "Unknown route" }, 400);
  } catch (err: any) {
    console.error("[pause-enforcement] error:", err);
    return json({ error: err?.message ?? "Internal error" }, 500);
  }
});
