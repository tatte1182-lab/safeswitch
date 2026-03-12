// ============================================================
// SafeSwitch · Edge Function: device-heartbeat
// supabase/functions/device-heartbeat/index.ts
//
// Called by the child app every 30s to signal the device is alive.
// Updates devices.last_seen_at — device_presence_current view
// recomputes automatically from that column.
//
// POST /device-heartbeat
// Body: { device_id: string, family_id: string }
// Response: { ok: true, last_seen_at: string }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, code: string, status = 400) {
  return json({ error: { code, message } }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  const body = await req.json().catch(() => null);
  if (!body?.device_id) return err("device_id required", "MISSING_FIELD");
  if (!body?.family_id) return err("family_id required", "MISSING_FIELD");

  // Authenticate the child app user
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    }
  );

  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  // Use service role to update — device row is not owned by the child user directly
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Verify device belongs to this family before updating
  const { data: device } = await svc
    .from("devices")
    .select("id, family_id, trust_state")
    .eq("id", body.device_id)
    .eq("family_id", body.family_id)
    .single();

  if (!device) return err("Device not found", "NOT_FOUND", 404);

  // Only heartbeat enrolled devices
  if (device.trust_state === "revoked" || device.trust_state === "suspended") {
    return err(`Device is ${device.trust_state}`, "DEVICE_INACTIVE", 403);
  }

  const last_seen_at = new Date().toISOString();

  const { error: updateErr } = await svc
    .from("devices")
    .update({ last_seen_at })
    .eq("id", body.device_id);

  if (updateErr) {
    console.error("[device-heartbeat] update error:", updateErr.message);
    return err("Failed to update heartbeat", "INTERNAL_ERROR", 500);
  }

  console.log(`[device-heartbeat] device=${body.device_id} last_seen=${last_seen_at}`);

  return json({ ok: true, last_seen_at });
});
