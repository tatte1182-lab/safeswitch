import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const SUPABASE_URL = "https://ylrdblwosarsunhwwsog.supabase.co";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface LocationPayload {
  device_id: string;
  family_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;        // m/s — used for "in vehicle" detection later
  heading: number | null;
  source: "significant_change" | "geofence" | "heartbeat" | "manual";
}

export interface HeartbeatPayload {
  device_id: string;
  family_id: string;
  battery_level: number | null;
  is_charging: boolean | null;
}

export async function getDeviceCredentials(): Promise<{
  deviceId: string;
  familyId: string;
} | null> {
  const deviceId = await SecureStore.getItemAsync("ss_device_id");
  const familyId = await SecureStore.getItemAsync("ss_family_id");
  if (!deviceId || !familyId) return null;
  return { deviceId, familyId };
}

export async function sendLocation(payload: LocationPayload): Promise<void> {
  const { error } = await supabase.from("device_locations").insert({
    device_id: payload.device_id,
    family_id: payload.family_id,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracy: payload.accuracy,
    altitude: payload.altitude,
    speed: payload.speed,
    heading: payload.heading,
    source: payload.source,
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[uplink] sendLocation error:", error.message);
    throw error;
  }
}

export async function sendHeartbeat(payload: HeartbeatPayload): Promise<void> {
  const { error } = await supabase.from("device_heartbeats").insert({
    device_id: payload.device_id,
    family_id: payload.family_id,
    battery_level: payload.battery_level,
    is_charging: payload.is_charging,
    pinged_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[uplink] sendHeartbeat error:", error.message);
    // heartbeat failures are non-fatal — swallow silently
  }
}
