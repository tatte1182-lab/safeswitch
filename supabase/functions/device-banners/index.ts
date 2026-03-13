// SafeSwitch · Edge Function · device-banners
// Corrected drop-in version

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_SOURCES = ["parent_pause", "parent_manual", "schedule", "system"] as const;
type BannerSource = (typeof VALID_SOURCES)[number];
type BannerAction = "set" | "clear";

type EnrolledDevice = {
  id: string;
  wireguard_ip: string;
  assigned_node_id: string;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function isValidSource(value: string): value is BannerSource {
  return VALID_SOURCES.includes(value as BannerSource);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildBannerDedupeKey(input: {
  node_id: string;
  device_id: string;
  action: BannerAction;
  child_id: string;
  banner_title: string | null;
  banner_body: string | null;
  banner_until: string | null;
  banner_source: string | null;
}): string {
  return [
    "state_banner",
    input.node_id,
    input.device_id,
    input.action,
    input.child_id,
    input.banner_title ?? "",
    input.banner_body ?? "",
    input.banner_until ?? "",
    input.banner_source ?? "",
  ].join(":");
}

async function verifyFamilyAccess(child_id: string, family_id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("children")
    .select("id")
    .eq("id", child_id)
    .eq("family_id", family_id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

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

async function getActiveNodesForFamily(
  family_id: string,
  nodeIds: string[],
): Promise<Set<string>> {
  if (!nodeIds.length) return new Set<string>();

  const { data, error } = await supabase
    .from("nodes")
    .select("id")
    .in("id", nodeIds)
    .eq("family_id", family_id)
    .eq("status", "active");

  if (error) throw error;
  return new Set((data ?? []).map((n) => n.id));
}

async function upsertBannerState(params: {
  child_id: string;
  banner_title: string | null;
  banner_body: string | null;
  banner_until: string | null;
  banner_source: string | null;
}) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("child_effective_state")
    .update({
      banner_title: params.banner_title,
      banner_body: params.banner_body,
      banner_until: params.banner_until,
      banner_source: params.banner_source,
      updated_at: nowIso,
    })
    .eq("child_id", params.child_id);

  if (error) throw error;
}

async function writeBannerSyncRows(params: {
  family_id: string;
  child_id: string;
  devices: EnrolledDevice[];
  banner_title: string | null;
  banner_body: string | null;
  banner_until: string | null;
  banner_source: string | null;
  trigger_source: string;
  action: BannerAction;
}): Promise<{ written: number; skipped: number }> {
  const {
    family_id,
    child_id,
    devices,
    banner_title,
    banner_body,
    banner_until,
    banner_source,
    trigger_source,
    action,
  } = params;

  if (!devices.length) return { written: 0, skipped: 0 };

  const uniqueNodeIds = [...new Set(devices.map((d) => d.assigned_node_id))];
  const activeNodeIds = await getActiveNodesForFamily(family_id, uniqueNodeIds);
  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const device of devices) {
    if (!activeNodeIds.has(device.assigned_node_id)) {
      skipped++;
      console.warn("[banners] skipping device — node inactive", {
        device_id: device.id,
        node_id: device.assigned_node_id,
      });
      continue;
    }

    rows.push({
      family_id,
      node_id: device.assigned_node_id,
      child_id,
      device_id: device.id,
      sync_type: "state_banner",
      status: "pending",
      trigger_source,
      dedupe_key: buildBannerDedupeKey({
        node_id: device.assigned_node_id,
        device_id: device.id,
        action,
        child_id,
        banner_title,
        banner_body,
        banner_until,
        banner_source,
      }),
      payload: {
        action,
        device_id: device.id,
        child_id,
        wireguard_ip: device.wireguard_ip,
        banner_title,
        banner_body,
        banner_until,
        banner_source,
      },
      created_at: nowIso,
      available_at: nowIso,
    });
  }

  if (!rows.length) return { written: 0, skipped };

  const { error } = await supabase
    .from("enforcement_sync_log")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });

  if (error) throw error;
  return { written: rows.length, skipped };
}

async function readCanonicalBanner(child_id: string) {
  const { data, error } = await supabase
    .from("child_effective_state")
    .select("banner_title, banner_body, banner_until, banner_source, updated_at")
    .eq("child_id", child_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function handleSet(body: Record<string, unknown>) {
  const child_id = typeof body.child_id === "string" ? body.child_id : "";
  const family_id = typeof body.family_id === "string" ? body.family_id : "";
  const title = normalizeText(body.title);
  const bannerBody = normalizeText(body.body);
  const source = typeof body.source === "string" ? body.source : "parent_manual";
  const until_minutes = typeof body.until_minutes === "number" ? body.until_minutes : null;

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }
  if (!title) {
    return json({ error: "title required" }, 400);
  }
  if (!isValidSource(source)) {
    return json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }, 400);
  }
  if (!(await verifyFamilyAccess(child_id, family_id))) {
    return json({ error: "Child not found in family" }, 403);
  }

  const banner_until =
    typeof until_minutes === "number" && Number.isFinite(until_minutes) && until_minutes > 0
      ? new Date(Date.now() + until_minutes * 60_000).toISOString()
      : null;

  await upsertBannerState({
    child_id,
    banner_title: title,
    banner_body: bannerBody,
    banner_until,
    banner_source: source,
  });

  const devices = await getEnrolledDevices(child_id);
  const syncResult = await writeBannerSyncRows({
    family_id,
    child_id,
    devices,
    banner_title: title,
    banner_body: bannerBody,
    banner_until,
    banner_source: source,
    trigger_source: "banner_set",
    action: "set",
  });

  return json({
    ok: true,
    child_id,
    banner_title: title,
    banner_body: bannerBody,
    banner_until,
    banner_source: source,
    device_count: devices.length,
    ...syncResult,
  });
}

async function handleClear(body: Record<string, unknown>) {
  const child_id = typeof body.child_id === "string" ? body.child_id : "";
  const family_id = typeof body.family_id === "string" ? body.family_id : "";

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }
  if (!(await verifyFamilyAccess(child_id, family_id))) {
    return json({ error: "Child not found in family" }, 403);
  }

  await upsertBannerState({
    child_id,
    banner_title: null,
    banner_body: null,
    banner_until: null,
    banner_source: null,
  });

  const devices = await getEnrolledDevices(child_id);
  const syncResult = await writeBannerSyncRows({
    family_id,
    child_id,
    devices,
    banner_title: null,
    banner_body: null,
    banner_until: null,
    banner_source: null,
    trigger_source: "banner_clear",
    action: "clear",
  });

  return json({
    ok: true,
    child_id,
    cleared: true,
    device_count: devices.length,
    ...syncResult,
  });
}

async function handleStatus(body: Record<string, unknown>) {
  const child_id = typeof body.child_id === "string" ? body.child_id : "";
  const family_id = typeof body.family_id === "string" ? body.family_id : "";

  if (!child_id || !family_id) {
    return json({ error: "child_id and family_id required" }, 400);
  }
  if (!(await verifyFamilyAccess(child_id, family_id))) {
    return json({ error: "Child not found in family" }, 403);
  }

  const canonicalBanner = await readCanonicalBanner(child_id);

  const { data: deviceStates, error: stateErr } = await supabase
    .from("child_effective_state")
    .select("device_id, banner_title, banner_body, banner_until, banner_source, updated_at")
    .eq("child_id", child_id)
    .order("updated_at", { ascending: false });

  if (stateErr) return json({ error: stateErr.message }, 500);

  const { data: recentSyncs, error: syncErr } = await supabase
    .from("enforcement_sync_log")
    .select("id, device_id, sync_type, status, payload, created_at, acked_at")
    .eq("child_id", child_id)
    .eq("sync_type", "state_banner")
    .order("created_at", { ascending: false })
    .limit(20);

  if (syncErr) return json({ error: syncErr.message }, 500);

  const hasBanner = Boolean(canonicalBanner?.banner_title);

  return json({
    ok: true,
    child_id,
    has_banner: hasBanner,
    banner: hasBanner
      ? {
          title: canonicalBanner?.banner_title ?? null,
          body: canonicalBanner?.banner_body ?? null,
          until: canonicalBanner?.banner_until ?? null,
          source: canonicalBanner?.banner_source ?? null,
          updated_at: canonicalBanner?.updated_at ?? null,
        }
      : null,
    device_states: deviceStates ?? [],
    recent_syncs: recentSyncs ?? [],
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const path = new URL(req.url).pathname.replace(/^\/device-banners/, "");

  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (path === "/set") return await handleSet(body);
    if (path === "/clear") return await handleClear(body);
    if (path === "/status") return await handleStatus(body);

    return json({ error: "Unknown route" }, 400);
  } catch (err) {
    console.error("[device-banners] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
