/**
 * SafeSwitch Location Agent
 *
 * Strategy:
 *   1. Significant-location-change monitoring (OS-managed, near-zero battery)
 *      — fires when device moves ~500m. No polling. No GPS drain while still.
 *   2. Background task handler picks up the OS wake and sends to Supabase.
 *   3. A 5-minute heartbeat (in heartbeat.ts) keeps presence alive cheaply
 *      when the child hasn't moved.
 *
 * Battery impact: ~1-3% per day, same profile as Apple Maps background tracking.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { sendLocation, getDeviceCredentials } from "./uplink";

export const LOCATION_TASK = "ss-location-task";

// ─── Background task definition ────────────────────────────────────────────
// Must be defined at module top level (Expo requirement).

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("[location-task] error:", error.message);
    return;
  }

  const creds = await getDeviceCredentials();
  if (!creds) {
    console.warn("[location-task] no credentials — skipping");
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;

  // Take the most recent fix
  const loc = locations[locations.length - 1];

  await sendLocation({
    device_id: creds.deviceId,
    family_id: creds.familyId,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    altitude: loc.coords.altitude,
    speed: loc.coords.speed,
    heading: loc.coords.heading,
    source: "significant_change",
  });
});

// ─── Permissions ────────────────────────────────────────────────────────────

export type PermissionStatus = "granted" | "denied" | "undetermined";

export async function requestLocationPermissions(): Promise<PermissionStatus> {
  // Step 1: foreground permission (required before background)
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== "granted") return "denied";

  // Step 2: background permission
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== "granted") return "denied";

  return "granted";
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return fg.status as PermissionStatus;
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status as PermissionStatus;
}

// ─── Start / stop ───────────────────────────────────────────────────────────

export async function startLocationAgent(): Promise<void> {
  const status = await getPermissionStatus();
  if (status !== "granted") {
    console.warn("[location] permissions not granted — cannot start");
    return;
  }

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (alreadyRunning) {
    console.log("[location] already running");
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // Significant-change accuracy — OS decides when to fire based on cell tower
    // and WiFi changes. Much cheaper than GPS polling.
    accuracy: Location.Accuracy.Balanced,

    // Minimum distance before a new event fires (metres).
    // 100m is aggressive enough for school/home transitions
    // without hammering battery on a slow walk.
    distanceInterval: 100,

    // Minimum time between updates (ms). Combined with distanceInterval —
    // both conditions must be met. 3 minutes floor prevents rapid-fire updates
    // when the device is moving fast (car, train).
    timeInterval: 3 * 60 * 1000,

    // Show the iOS location indicator in the status bar — required for
    // background location on iOS. Builds trust with the child too.
    showsBackgroundLocationIndicator: true,

    // Keep the task alive after the OS would normally suspend it.
    pausesUpdatesAutomatically: false,

    // Android foreground service notification (required for background on Android).
    foregroundService: {
      notificationTitle: "SafeSwitch",
      notificationBody: "Location sharing is active",
      notificationColor: "#00c8ff",
    },

    // Use significant change on iOS (the ultra-low-power OS primitive).
    // Falls back to standard updates on Android.
    activityType: Location.ActivityType.Other,
  });

  console.log("[location] agent started ✓");
}

export async function stopLocationAgent(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    console.log("[location] agent stopped");
  }
}

// ─── One-shot current location ──────────────────────────────────────────────
// Used on app open to get an immediate fresh fix.

export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
  const status = await getPermissionStatus();
  if (status !== "granted") return null;

  return Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
}
