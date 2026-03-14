/**
 * SafeSwitch Edge Function: ingest-location
 *
 * Handles two routes:
 *   POST /ingest-location/push    — regular location update from device
 *   POST /ingest-location/ack     — device fulfilling a pull-on-demand request
 *
 * On every call it:
 *   1. Inserts into device_locations (history)
 *   2. Upserts child_location_current (live projection)
 *   3. For /ack: marks the locate_request as fulfilled
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LocationBody {
  device_id: string;
  family_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  source: "significant_change" | "geofence" | "heartbeat" | "manual" | "on_demand";
  recorded_at?: string;
  // For /ack only
  request_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const route = url.pathname.split("/").pop(); // "push" or "ack"

  if (!["push", "ack"].includes(route ?? "")) {
    return new Response(JSON.stringify({ error: "Unknown route" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: LocationBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Validate required fields ──────────────────────────────
  if (!body.device_id || !body.family_id || body.latitude == null || body.longitude == null) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const recordedAt = body.recorded_at ?? new Date().toISOString();

  // ─── 1. Insert raw location history ───────────────────────
  const { error: insertError } = await supabase
    .from("device_locations")
    .insert({
      device_id: body.device_id,
      family_id: body.family_id,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy ?? null,
      altitude: body.altitude ?? null,
      speed: body.speed ?? null,
      heading: body.heading ?? null,
      source: body.source,
      recorded_at: recordedAt,
    });

  if (insertError) {
    console.error("[ingest-location] insert error:", insertError.message);
    return new Response(JSON.stringify({ error: "Failed to insert location" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── 2. Upsert child_location_current ─────────────────────
  // Fetch latest heartbeat for battery info to merge in
  const { data: hb } = await supabase
    .from("device_heartbeats")
    .select("battery_level, is_charging, pinged_at")
    .eq("device_id", body.device_id)
    .order("pinged_at", { ascending: false })
    .limit(1)
    .single();

  const { error: upsertError } = await supabase
    .from("child_location_current")
    .upsert({
      device_id: body.device_id,
      family_id: body.family_id,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy ?? null,
      altitude: body.altitude ?? null,
      speed: body.speed ?? null,
      heading: body.heading ?? null,
      source: body.source,
      recorded_at: recordedAt,
      last_heartbeat_at: hb?.pinged_at ?? null,
      battery_level: hb?.battery_level ?? null,
      is_charging: hb?.is_charging ?? null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "device_id",
    });

  if (upsertError) {
    console.error("[ingest-location] upsert error:", upsertError.message);
    // Non-fatal — history was saved, projection failed
  }

  // ─── 3. Trigger geofence check (fire and forget) ──────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  fetch(`${supabaseUrl}/functions/v1/check-geofences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      device_id: body.device_id,
      family_id: body.family_id,
      latitude: body.latitude,
      longitude: body.longitude,
    }),
  }).catch(e => console.warn("[ingest-location] geofence check error:", e.message));

  // ─── 4. If this is an ack, fulfil the locate_request ──────
  if (route === "ack" && body.request_id) {
    const { error: ackError } = await supabase
      .from("locate_requests")
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
      })
      .eq("id", body.request_id)
      .eq("device_id", body.device_id)
      .eq("status", "pending");

    if (ackError) {
      console.warn("[ingest-location] ack error:", ackError.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
