/**
 * SafeSwitch Command Listener
 *
 * Subscribes to locate_requests via Supabase Realtime.
 * When a parent taps "Locate Now", a row appears here.
 * We do a GPS fix and send it back via the ingest-location/ack route.
 */

import * as Location from "expo-location";
import { supabase, getDeviceCredentials } from "./uplink";

const INGEST_URL = "https://ylrdblwosarsunhwwsog.supabase.co/functions/v1/ingest-location";

let channel: ReturnType<typeof supabase.channel> | null = null;

export async function startCommandListener(): Promise<void> {
  const creds = await getDeviceCredentials();
  if (!creds) return;

  // Clean up any existing subscription
  if (channel) {
    await supabase.removeChannel(channel);
  }

  channel = supabase
    .channel(`locate-requests-${creds.deviceId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "locate_requests",
        // Only fire for requests aimed at this device
        filter: `device_id=eq.${creds.deviceId}`,
      },
      async (payload) => {
        const request = payload.new as {
          id: string;
          device_id: string;
          expires_at: string;
          status: string;
        };

        // Ignore if already expired
        if (new Date(request.expires_at) < new Date()) {
          console.log("[commands] locate request already expired — ignoring");
          return;
        }

        console.log("[commands] locate request received:", request.id);
        await fulfillLocateRequest(request.id, creds.deviceId, creds.familyId);
      }
    )
    .subscribe((status) => {
      console.log("[commands] subscription status:", status);
    });
}

async function fulfillLocateRequest(
  requestId: string,
  deviceId: string,
  familyId: string
): Promise<void> {
  try {
    // Get a fresh GPS fix
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const res = await fetch(`${INGEST_URL}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: deviceId,
        family_id: familyId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        altitude: loc.coords.altitude,
        speed: loc.coords.speed,
        heading: loc.coords.heading,
        source: "on_demand",
        request_id: requestId,
      }),
    });

    if (!res.ok) {
      console.error("[commands] ack failed:", await res.text());
    } else {
      console.log("[commands] locate request fulfilled ✓");
    }
  } catch (err) {
    console.error("[commands] fulfillLocateRequest error:", err);
  }
}

export async function stopCommandListener(): Promise<void> {
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
}
