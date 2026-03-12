// ============================================================
// SafeSwitch · useDeviceHeartbeat
// src/hooks/useDeviceHeartbeat.ts
//
// Fires a heartbeat to the device-heartbeat edge function
// every 30 seconds while the app is in the foreground.
// Pauses when the app goes to the background.
//
// Usage:
//   useDeviceHeartbeat({ deviceId, familyId, authToken })
// ============================================================

import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/device-heartbeat`;

interface HeartbeatOptions {
  deviceId:  string | null;
  familyId:  string | null;
  authToken: string | null;
  onPresence?: (presence: string) => void;
}

export function useDeviceHeartbeat({
  deviceId,
  familyId,
  authToken,
  onPresence,
}: HeartbeatOptions) {
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef  = useRef<AppStateStatus>(AppState.currentState);
  const isMounted    = useRef(true);

  const sendHeartbeat = useCallback(async () => {
    if (!deviceId || !familyId || !authToken) return;

    try {
      const res = await fetch(HEARTBEAT_URL, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${authToken}`,
        },
        body: JSON.stringify({ device_id: deviceId, family_id: familyId }),
      });

      if (!res.ok) {
        console.warn("[heartbeat] server error:", res.status);
        return;
      }

      const data = await res.json();
      if (isMounted.current && onPresence && data.presence) {
        onPresence(data.presence);
      }
    } catch (e) {
      // Network error — app may be offline, silent fail is correct here
      console.warn("[heartbeat] network error:", e);
    }
  }, [deviceId, familyId, authToken, onPresence]);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return; // already running
    sendHeartbeat(); // fire immediately on start
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }, [sendHeartbeat]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Pause heartbeat when app goes to background, resume on foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "active" && prev !== "active") {
        startInterval();
      } else if (nextState !== "active") {
        stopInterval();
      }
    });

    return () => subscription.remove();
  }, [startInterval, stopInterval]);

  // Start on mount if we have credentials, stop on unmount
  useEffect(() => {
    isMounted.current = true;

    if (deviceId && familyId && authToken) {
      startInterval();
    }

    return () => {
      isMounted.current = false;
      stopInterval();
    };
  }, [deviceId, familyId, authToken, startInterval, stopInterval]);
}
