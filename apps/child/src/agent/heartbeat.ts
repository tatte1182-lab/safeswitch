/**
 * SafeSwitch Heartbeat Agent
 *
 * Sends a lightweight "still alive" ping every 5 minutes.
 * No GPS involved — just device_id + timestamp + battery.
 *
 * This keeps `device_presence_current` fresh even when the child
 * hasn't moved. The dashboard shows "last seen 3 mins ago at school"
 * rather than going stale between significant location events.
 */

import * as Battery from "expo-battery";
import { sendHeartbeat, getDeviceCredentials } from "./uplink";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function ping(): Promise<void> {
  const creds = await getDeviceCredentials();
  if (!creds) return;

  let batteryLevel: number | null = null;
  let isCharging: boolean | null = null;

  try {
    batteryLevel = await Battery.getBatteryLevelAsync();           // 0.0–1.0
    const state = await Battery.getBatteryStateAsync();
    isCharging = state === Battery.BatteryState.CHARGING ||
                 state === Battery.BatteryState.FULL;
  } catch {
    // Battery API unavailable on some simulators — non-fatal
  }

  await sendHeartbeat({
    device_id: creds.deviceId,
    family_id: creds.familyId,
    battery_level: batteryLevel !== null ? Math.round(batteryLevel * 100) : null,
    is_charging: isCharging,
  });
}

export function startHeartbeat(): void {
  if (heartbeatTimer) return;

  // Fire immediately on start, then every 5 minutes
  ping().catch(console.error);
  heartbeatTimer = setInterval(() => {
    ping().catch(console.error);
  }, HEARTBEAT_INTERVAL_MS);

  console.log("[heartbeat] started ✓");
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[heartbeat] stopped");
  }
}
