// SafeSwitch · Edge Function · enforcement-feedback
//
// Routes:
//   POST /enforcement-feedback/child   { child_id, family_id }
//   POST /enforcement-feedback/device  { device_id, family_id }
//   POST /enforcement-feedback/family  { family_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requiredEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function isActiveBannerRow(
  row: { banner_title?: string | null; banner_until?: string | null },
  nowIso: string,
): boolean {
  if (!row.banner_title) return false;
  if (!row.banner_until) return true;
  return row.banner_until > nowIso;
}

async function getAuthedUser(req: Request): Promise<{ id: string } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Access control ────────────────────────────────────────────

async function verifyFamilyMemberAccess(userId: string, family_id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("family_id", family_id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function verifyFamilyAccess(
  userId: string,
  child_id: string,
  family_id: string,
): Promise<boolean> {
  const [membershipOk, childRes] = await Promise.all([
    verifyFamilyMemberAccess(userId, family_id),
    supabase
      .from("children")
      .select("id")
      .eq("id", child_id)
      .eq("family_id", family_id)
      .maybeSingle(),
  ]);

  if (childRes.error) throw childRes.error;
  return membershipOk && Boolean(childRes.data);
}

async function verifyDeviceFamilyAccess(
  userId: string,
  device_id: string,
  family_id: string,
): Promise<boolean> {
  const [membershipOk, deviceRes] = await Promise.all([
    verifyFamilyMemberAccess(userId, family_id),
    supabase
      .from("devices")
      .select("id")
      .eq("id", device_id)
      .eq("family_id", family_id)
      .maybeSingle(),
  ]);

  if (deviceRes.error) throw deviceRes.error;
  return membershipOk && Boolean(deviceRes.data);
}

// ── Core fetch ─────────────────────────────────────────────────

async function fetchChildFeedback(child_id: string) {
  const nowIso = new Date().toISOString();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();

  const [{ data: policy, error: policyErr }, { data: states, error: statesErr }] =
    await Promise.all([
      supabase
        .from("child_policy_profiles")
        .select("is_paused, paused_until, updated_at")
        .eq("child_id", child_id)
        .maybeSingle(),
      supabase
        .from("child_effective_state")
        .select(`
          device_id, child_id, family_id, node_id,
          internet_paused, resolved_route_mode,
          banner_title, banner_body, banner_until, banner_source,
          state_hash, last_computed_at, pushed_to_node_at, pushed_to_device_at,
          state_summary, state_color, state_reason, next_state_change_at
        `)
        .eq("child_id", child_id)
        .order("last_computed_at", { ascending: false }),
    ]);

  if (policyErr) throw policyErr;
  if (statesErr) throw statesErr;

  const effectiveStates = states ?? [];
  const deviceIds = effectiveStates.map((s) => s.device_id).filter(Boolean);
  const nodeIds = [...new Set(effectiveStates.map((s) => s.node_id).filter(Boolean))] as string[];

  const [
    { data: recentSyncs,      error: syncErr         },
    { data: stuckPending,     error: stuckPendingErr  },
    { data: stuckLeased,      error: stuckLeasedErr   },
    { data: failedRows,       error: failedErr        },
    { data: deviceHeartbeats, error: devHbErr         },
    { data: nodeHeartbeats,   error: nodeHbErr        },
  ] = await Promise.all([
    supabase
      .from("enforcement_sync_log")
      .select(`
        id, child_id, device_id, node_id, sync_type, status,
        trigger_source, dedupe_key, attempt_count,
        created_at, available_at, leased_at, lease_expires_at,
        acked_at, error_message, result
      `)
      .eq("child_id", child_id)
      .order("created_at", { ascending: false })
      .limit(30),

    supabase
      .from("enforcement_sync_log")
      .select("id, device_id, node_id, sync_type, status, attempt_count, created_at, error_message")
      .eq("child_id", child_id)
      .eq("status", "pending")
      .lt("created_at", twoMinutesAgo),

    supabase
      .from("enforcement_sync_log")
      .select("id, device_id, node_id, sync_type, status, attempt_count, created_at, leased_at, error_message")
      .eq("child_id", child_id)
      .eq("status", "leased")
      .lt("leased_at", twoMinutesAgo),

    supabase
      .from("enforcement_sync_log")
      .select("id, device_id, node_id, sync_type, status, attempt_count, created_at, error_message")
      .eq("child_id", child_id)
      .eq("status", "failed"),

    deviceIds.length
      ? supabase
          .from("device_heartbeats")
          .select("device_id, battery_level, is_charging, pinged_at")
          .in("device_id", deviceIds)
      : Promise.resolve({ data: [], error: null }),

    nodeIds.length
      ? supabase
          .from("node_heartbeats")
          .select("node_id, public_ip, endpoint, tunnel_status, dns_status, software_version, pinged_at")
          .in("node_id", nodeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (syncErr)         throw syncErr;
  if (stuckPendingErr) throw stuckPendingErr;
  if (stuckLeasedErr)  throw stuckLeasedErr;
  if (failedErr)       throw failedErr;
  if (devHbErr)        throw devHbErr;
  if (nodeHbErr)       throw nodeHbErr;

  const syncs = recentSyncs ?? [];
  const stuckSyncs = [...(stuckPending ?? []), ...(stuckLeased ?? []), ...(failedRows ?? [])];

  const ackLatencies = syncs
    .filter((s) => s.created_at && s.acked_at)
    .map((s) => new Date(s.acked_at as string).getTime() - new Date(s.created_at).getTime())
    .filter((v) => Number.isFinite(v) && v >= 0);

  const deviceHeartbeatById = new Map((deviceHeartbeats ?? []).map((d) => [d.device_id, d]));
  const nodeHeartbeatById   = new Map((nodeHeartbeats   ?? []).map((n) => [n.node_id,   n]));

  const enrichedStates = effectiveStates.map((s) => ({
    ...s,
    device_heartbeat: deviceHeartbeatById.get(s.device_id) ?? null,
    node_heartbeat:   s.node_id ? nodeHeartbeatById.get(s.node_id) ?? null : null,
  }));

  const activeBanner = effectiveStates.find((s) => isActiveBannerRow(s, nowIso)) ?? null;

  return {
    child_id,
    policy_paused:     policy?.is_paused    ?? false,
    paused_until:      policy?.paused_until ?? null,
    policy_updated_at: policy?.updated_at   ?? null,
    has_banner: Boolean(activeBanner),
    banner: activeBanner
      ? { title: activeBanner.banner_title, body: activeBanner.banner_body, until: activeBanner.banner_until, source: activeBanner.banner_source }
      : null,
    effective_states: enrichedStates,
    sync_health: {
      total:   syncs.length,
      acked:   syncs.filter((s) => s.status === "acked").length,
      pending: syncs.filter((s) => s.status === "pending").length,
      leased:  syncs.filter((s) => s.status === "leased").length,
      failed:  syncs.filter((s) => s.status === "failed").length,
      stuck:   stuckSyncs.length,
      avg_ack_latency_ms: average(ackLatencies),
    },
    recent_syncs: syncs,
    stuck_syncs:  stuckSyncs,
  };
}

async function fetchDeviceFeedback(device_id: string) {
  const nowIso = new Date().toISOString();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();

  const [{ data: state, error: stateErr }, { data: recentSyncs, error: syncErr }] =
    await Promise.all([
      supabase
        .from("child_effective_state")
        .select(`
          child_id,
          family_id,
          device_id,
          node_id,
          internet_paused,
          resolved_route_mode,
          banner_title,
          banner_body,
          banner_until,
          banner_source,
          state_hash,
          last_computed_at,
          pushed_to_node_at,
          pushed_to_device_at,
          state_summary,
          state_color,
          state_reason,
          next_state_change_at
        `)
        .eq("device_id", device_id)
        .maybeSingle(),

      supabase
        .from("enforcement_sync_log")
        .select(`
          id,
          sync_type,
          status,
          trigger_source,
          dedupe_key,
          attempt_count,
          created_at,
          leased_at,
          acked_at,
          error_message,
          result
        `)
        .eq("device_id", device_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (stateErr) throw stateErr;
  if (syncErr) throw syncErr;

  const nodeId = state?.node_id ?? null;

  const [
    { data: stuckPendingRows, error: stuckPendingErr },
    { data: stuckLeasedRows,  error: stuckLeasedErr  },
    { data: failedRows,       error: failedErr       },
    { data: deviceHeartbeat,  error: devHbErr        },
    { data: nodeHeartbeat,    error: nodeHbErr       },
  ] = await Promise.all([
    supabase
      .from("enforcement_sync_log")
      .select("id, sync_type, status, attempt_count, created_at, leased_at, error_message")
      .eq("device_id", device_id)
      .eq("status", "pending")
      .lt("created_at", twoMinutesAgo),

    supabase
      .from("enforcement_sync_log")
      .select("id, sync_type, status, attempt_count, created_at, leased_at, error_message")
      .eq("device_id", device_id)
      .eq("status", "leased")
      .lt("leased_at", twoMinutesAgo),

    supabase
      .from("enforcement_sync_log")
      .select("id, sync_type, status, attempt_count, created_at, leased_at, error_message")
      .eq("device_id", device_id)
      .eq("status", "failed"),

    supabase
      .from("device_heartbeats")
      .select("device_id, battery_level, is_charging, pinged_at")
      .eq("device_id", device_id)
      .maybeSingle(),

    nodeId
      ? supabase
          .from("node_heartbeats")
          .select("node_id, public_ip, endpoint, tunnel_status, dns_status, software_version, pinged_at")
          .eq("node_id", nodeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (stuckPendingErr) throw stuckPendingErr;
  if (stuckLeasedErr)  throw stuckLeasedErr;
  if (failedErr)       throw failedErr;
  if (devHbErr)        throw devHbErr;
  if (nodeHbErr)       throw nodeHbErr;

  const syncs = recentSyncs ?? [];
  const stuckSyncs = [
    ...(stuckPendingRows ?? []),
    ...(stuckLeasedRows  ?? []),
    ...(failedRows       ?? []),
  ];

  const ackLatencies = syncs
    .filter((s) => s.created_at && s.acked_at)
    .map((s) => new Date(s.acked_at as string).getTime() - new Date(s.created_at).getTime())
    .filter((v) => Number.isFinite(v) && v >= 0);

  return {
    device_id,
    state: state
      ? { ...state, has_active_banner: isActiveBannerRow(state, nowIso), device_heartbeat: deviceHeartbeat ?? null, node_heartbeat: nodeHeartbeat ?? null }
      : null,
    sync_health: {
      total:   syncs.length,
      acked:   syncs.filter((s) => s.status === "acked").length,
      pending: syncs.filter((s) => s.status === "pending").length,
      leased:  syncs.filter((s) => s.status === "leased").length,
      failed:  syncs.filter((s) => s.status === "failed").length,
      stuck:   stuckSyncs.length,
      avg_ack_latency_ms: average(ackLatencies),
    },
    recent_syncs: syncs,
    stuck_syncs:  stuckSyncs,
  };
}

async function fetchFamilyFeedback(family_id: string) {
  const { data: children, error: childErr } = await supabase
    .from("children")
    .select("id, display_name")
    .eq("family_id", family_id)
    .order("display_name", { ascending: true });

  if (childErr) throw childErr;
  if (!children?.length) {
    return {
      family_id,
      family_health: { total_children: 0, paused_children: 0, children_with_banner: 0, total_stuck_syncs: 0, total_failed_syncs: 0 },
      children: [],
    };
  }

  const results = await Promise.all(
    children.map(async (child) => {
      const feedback = await fetchChildFeedback(child.id);
      return { display_name: child.display_name, ...feedback };
    }),
  );

  return {
    family_id,
    family_health: {
      total_children:       results.length,
      paused_children:      results.filter((c) => c.policy_paused).length,
      children_with_banner: results.filter((c) => c.has_banner).length,
      total_stuck_syncs:    results.reduce((acc, c) => acc + c.stuck_syncs.length, 0),
      total_failed_syncs:   results.reduce((acc, c) => acc + c.sync_health.failed, 0),
    },
    children: results,
  };
}

// ── Handlers ──────────────────────────────────────────────────

async function handleChild(body: Record<string, unknown>, userId: string) {
  const child_id  = typeof body.child_id  === "string" ? body.child_id.trim()  : "";
  const family_id = typeof body.family_id === "string" ? body.family_id.trim() : "";

  if (!child_id || !family_id) return json({ error: "child_id and family_id required" }, 400);
  if (!await verifyFamilyAccess(userId, child_id, family_id)) return json({ error: "Child not found in family or access denied" }, 403);

  return json({ ok: true, ...(await fetchChildFeedback(child_id)) });
}

async function handleDevice(body: Record<string, unknown>, userId: string) {
  const device_id = typeof body.device_id === "string" ? body.device_id.trim() : "";
  const family_id = typeof body.family_id === "string" ? body.family_id.trim() : "";

  if (!device_id || !family_id) return json({ error: "device_id and family_id required" }, 400);
  if (!await verifyDeviceFamilyAccess(userId, device_id, family_id)) return json({ error: "Device not found in family or access denied" }, 403);

  return json({ ok: true, ...(await fetchDeviceFeedback(device_id)) });
}

async function handleFamily(body: Record<string, unknown>, userId: string) {
  const family_id = typeof body.family_id === "string" ? body.family_id.trim() : "";

  if (!family_id) return json({ error: "family_id required" }, 400);
  if (!await verifyFamilyMemberAccess(userId, family_id)) return json({ error: "Family access denied" }, 403);

  return json({ ok: true, ...(await fetchFamilyFeedback(family_id)) });
}

// ── Main ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const path = new URL(req.url).pathname.replace(/^\/enforcement-feedback/, "");
    const body = (await req.json()) as Record<string, unknown>;

    if (path === "/child")  return await handleChild(body, user.id);
    if (path === "/device") return await handleDevice(body, user.id);
    if (path === "/family") return await handleFamily(body, user.id);

    return json({ error: "Unknown route" }, 400);
  } catch (err) {
    console.error("[enforcement-feedback] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
