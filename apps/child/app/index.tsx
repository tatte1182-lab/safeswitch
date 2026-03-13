/**
 * SafeSwitch Child App
 *
 * Minimal UI. The app's real job is running the background agents.
 * The screen shows the child their connection status and when location
 * sharing is active — no hidden tracking.
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  requestLocationPermissions,
  getPermissionStatus,
  startLocationAgent,
  getCurrentLocation,
} from "../src/agent/location";
import { startHeartbeat } from "../src/agent/heartbeat";
import { startCommandListener } from "../src/agent/commands";
import { isEnrolled, loadCredentials } from "../src/store/device";
import { sendLocation } from "../src/agent/uplink";

type AppState = "loading" | "not-enrolled" | "needs-permission" | "active" | "error";

export default function App() {
  const [state, setState] = useState<AppState>("loading");
  const [deviceName, setDeviceName] = useState("");
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string>("");

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    try {
      // 1. Check enrollment
      const enrolled = await isEnrolled();
      if (!enrolled) {
        setState("not-enrolled");
        return;
      }

      const creds = await loadCredentials();
      setDeviceName(creds?.deviceName ?? "This device");

      // 2. Check location permissions
      const perm = await getPermissionStatus();
      setPermissionStatus(perm);

      if (perm !== "granted") {
        setState("needs-permission");
        return;
      }

      // 3. Start agents
      await startLocationAgent();
      startHeartbeat();
      await startCommandListener(); // listens for parent "Locate Now" requests

      // 4. Send an immediate location fix on open
      const loc = await getCurrentLocation();
      if (loc && creds) {
        await sendLocation({
          device_id: creds.deviceId,
          family_id: creds.familyId,
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
          altitude: loc.coords.altitude,
          speed: loc.coords.speed,
          heading: loc.coords.heading,
          source: "manual",
        });
        setLastSeen(new Date().toLocaleTimeString());
      }

      setState("active");
    } catch (err) {
      console.error("[boot]", err);
      setState("error");
    }
  }

  async function handleGrantPermission() {
    setState("loading");
    const result = await requestLocationPermissions();
    if (result === "granted") {
      await boot();
    } else {
      setPermissionStatus("denied");
      setState("needs-permission");
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>SS</Text>
        </View>
        <Text style={styles.appName}>SafeSwitch</Text>
      </View>

      {/* State content */}
      {state === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color="#00c8ff" size="large" />
          <Text style={styles.dimText}>Starting up…</Text>
        </View>
      )}

      {state === "not-enrolled" && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Not enrolled</Text>
          <Text style={styles.cardBody}>
            Ask a parent to scan you in from the SafeSwitch dashboard.
          </Text>
        </View>
      )}

      {state === "needs-permission" && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location permission needed</Text>
          <Text style={styles.cardBody}>
            SafeSwitch needs background location access to share your location
            with your family. This is shown in your status bar when active.
          </Text>
          {permissionStatus === "denied" && (
            <Text style={[styles.cardBody, { color: "#ff4757", marginTop: 8 }]}>
              Permission was denied. You may need to enable it in Settings →
              SafeSwitch → Location → Always.
            </Text>
          )}
          {permissionStatus !== "denied" && (
            <TouchableOpacity style={styles.button} onPress={handleGrantPermission}>
              <Text style={styles.buttonText}>Allow location access</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {state === "active" && (
        <View style={styles.card}>
          {/* Status indicator */}
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Connected</Text>
          </View>

          <Text style={styles.deviceName}>{deviceName}</Text>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Location sharing</Text>
            <Text style={styles.infoValue}>Active</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Updates on significant move</Text>
            <Text style={styles.infoValue}>Every 100m+</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Heartbeat</Text>
            <Text style={styles.infoValue}>Every 5 min</Text>
          </View>

          {lastSeen && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Last sent</Text>
              <Text style={styles.infoValue}>{lastSeen}</Text>
            </View>
          )}

          <Text style={styles.footnote}>
            Your family can see your location in the SafeSwitch app.
            {Platform.OS === "ios"
              ? " The blue arrow in your status bar shows when location is active."
              : " A notification shows when location sharing is running."}
          </Text>
        </View>
      )}

      {state === "error" && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Something went wrong</Text>
          <Text style={styles.cardBody}>
            Could not start SafeSwitch. Check your connection and try again.
          </Text>
          <TouchableOpacity style={styles.button} onPress={boot}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0d14",
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 40,
  },
  logoBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#00c8ff18",
    borderWidth: 1,
    borderColor: "#00c8ff40",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    color: "#00c8ff",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 1,
  },
  appName: {
    color: "#e8edf8",
    fontWeight: "700",
    fontSize: 20,
    letterSpacing: -0.5,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  dimText: {
    color: "#54637f",
    fontSize: 14,
  },
  card: {
    backgroundColor: "#161c2e",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1e2a42",
    padding: 24,
  },
  cardTitle: {
    color: "#e8edf8",
    fontWeight: "700",
    fontSize: 18,
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  cardBody: {
    color: "#97a6c3",
    fontSize: 14,
    lineHeight: 22,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00e5a0",
    shadowColor: "#00e5a0",
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  statusText: {
    color: "#00e5a0",
    fontWeight: "600",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  deviceName: {
    color: "#e8edf8",
    fontWeight: "700",
    fontSize: 22,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  divider: {
    height: 1,
    backgroundColor: "#1e2a42",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  infoLabel: {
    color: "#54637f",
    fontSize: 13,
  },
  infoValue: {
    color: "#97a6c3",
    fontSize: 13,
    fontWeight: "600",
  },
  footnote: {
    color: "#54637f",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#1e2a42",
    paddingTop: 16,
  },
  button: {
    backgroundColor: "#00c8ff18",
    borderWidth: 1,
    borderColor: "#00c8ff40",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  buttonText: {
    color: "#00c8ff",
    fontWeight: "700",
    fontSize: 15,
  },
});
