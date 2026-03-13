/**
 * SafeSwitch Edge Function: check-geofences
 *
 * Called by ingest-location after every location update.
 * Checks all active geofences for the family and fires
 * enter/exit events when a device crosses a boundary.
 *
 * POST /check-geofences
 * Body: { device_id, family_id, latitude, longitude }
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

interface CheckBody {
  device_id: string;
  family_id: string;
  latitude: number;
  longitude: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: CheckBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders });
  }

  const { device_id, family_id, latitude, longitude } = body;
  if (!device_id || !family_id || latitude == null || longitude == null) {
    return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: corsHeaders });
  }

  // Fetch all active geofences for this family that apply to this device
  const { data: geofences } = await supabase
    .from("geofences")
    .select("*")
    .eq("family_id", family_id)
    .eq("is_active", true);

  if (!geofences?.length) {
    return new Response(JSON.stringify({ ok: true, checked: 0 }), { headers: corsHeaders });
  }

  // Filter geofences that apply to this device
  const applicable = geofences.filter(g =>
    !g.device_ids || g.device_ids.length === 0 || g.device_ids.includes(device_id)
  );

  // Fetch current geofence state for this device
  const { data: states } = await supabase
    .from("device_geofence_state")
    .select("geofence_id, is_inside")
    .eq("device_id", device_id);

  const stateMap: Record<string, boolean> = {};
  (states || []).forEach(s => { stateMap[s.geofence_id] = s.is_inside; });

  // Fetch device name for alert
  const { data: device } = await supabase
    .from("devices")
    .select("display_name")
    .eq("id", device_id)
    .single();
  const deviceName = device?.display_name ?? "Device";

  const events: Promise<void>[] = [];

  for (const gf of applicable) {
    const wasInside = stateMap[gf.id] ?? null;
    const nowInside = gf.type === "circle"
      ? isInsideCircle(latitude, longitude, gf.latitude, gf.longitude, gf.radius_metres)
      : isInsideTripwire(latitude, longitude, gf.lat_a, gf.lng_a, gf.lat_b, gf.lng_b, stateMap[gf.id]);

    // First time we've seen this device near this geofence — just record state
    if (wasInside === null) {
      await supabase.from("device_geofence_state").upsert({
        device_id, geofence_id: gf.id, is_inside: nowInside, updated_at: new Date().toISOString()
      });
      continue;
    }

    const crossed = wasInside !== nowInside;
    if (!crossed) continue;

    const eventType = nowInside ? "enter" : "exit";

    // Check if we should alert for this event type
    if (gf.alert_on !== "both" && gf.alert_on !== eventType) {
      await supabase.from("device_geofence_state").upsert({
        device_id, geofence_id: gf.id, is_inside: nowInside, updated_at: new Date().toISOString()
      });
      continue;
    }

    events.push(
      fireEvent(device_id, family_id, gf, eventType, latitude, longitude, deviceName)
    );

    // Update state
    await supabase.from("device_geofence_state").upsert({
      device_id, geofence_id: gf.id, is_inside: nowInside, updated_at: new Date().toISOString()
    });
  }

  await Promise.all(events);

  return new Response(JSON.stringify({ ok: true, checked: applicable.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});

// ─── Geometry ────────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInsideCircle(lat: number, lng: number, cLat: number, cLng: number, radius: number): boolean {
  return haversineMetres(lat, lng, cLat, cLng) <= radius;
}

/**
 * Tripwire: detects which side of the line A→B the device is on.
 * Uses the sign of the cross product of (B-A) × (P-A).
 * A sign change = line crossed.
 */
function getTripwireSide(lat: number, lng: number, latA: number, lngA: number, latB: number, lngB: number): boolean {
  const cross = (lngB - lngA) * (lat - latA) - (latB - latA) * (lng - lngA);
  return cross >= 0;
}

function isInsideTripwire(lat: number, lng: number, latA: number, lngA: number, latB: number, lngB: number, prevSide: boolean | undefined): boolean {
  const side = getTripwireSide(lat, lng, latA, lngA, latB, lngB);
  // For tripwires "inside" means side === true (one side of the line)
  return side;
}

// ─── Fire event + alert ───────────────────────────────────────────────────────

async function fireEvent(
  deviceId: string, familyId: string, geofence: Record<string, unknown>,
  eventType: string, latitude: number, longitude: number, deviceName: string
): Promise<void> {
  // Insert geofence event
  const { data: event } = await supabase.from("geofence_events").insert({
    geofence_id: geofence.id,
    family_id: familyId,
    device_id: deviceId,
    event_type: eventType,
    latitude,
    longitude,
    occurred_at: new Date().toISOString(),
  }).select("id").single();

  if (!event) return;

  // Insert alert for dashboard
  await supabase.from("geofence_alerts").insert({
    family_id: familyId,
    geofence_event_id: event.id,
    device_id: deviceId,
    geofence_name: geofence.name as string,
    event_type: eventType,
    device_name: deviceName,
    is_read: false,
    created_at: new Date().toISOString(),
  });

  // FCM push notification (non-fatal if no token configured)
  await sendFCMNotification(familyId, deviceName, geofence.name as string, eventType);
}

async function sendFCMNotification(
  familyId: string, deviceName: string, geofenceName: string, eventType: string
): Promise<void> {
  const fcmKey = Deno.env.get("FCM_SERVER_KEY");
  if (!fcmKey) return; // FCM not configured yet

  // Fetch parent FCM tokens for this family
  const { data: tokens } = await supabase
    .from("profiles")
    .select("fcm_token")
    .eq("family_id", familyId)
    .not("fcm_token", "is", null);

  if (!tokens?.length) return;

  const verb = eventType === "enter" ? "arrived at" : "left";
  const body = `${deviceName} ${verb} ${geofenceName}`;

  await Promise.all(tokens.map(({ fcm_token }) =>
    fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Authorization": `key=${fcmKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: fcm_token,
        notification: { title: "SafeSwitch", body },
        data: { type: "geofence_alert", event_type: eventType, geofence_name: geofenceName },
      }),
    }).catch(console.error)
  ));
}
