/**
 * SafeSwitch Device Store
 *
 * Persists enrollment credentials in the device's secure enclave.
 * These are written once during enrollment and read by the location
 * agent on every background wake.
 */

import * as SecureStore from "expo-secure-store";

const KEYS = {
  DEVICE_ID: "ss_device_id",
  FAMILY_ID: "ss_family_id",
  DEVICE_NAME: "ss_device_name",
  AUTH_TOKEN: "ss_auth_token",
  ENROLLED_AT: "ss_enrolled_at",
};

export interface DeviceCredentials {
  deviceId: string;
  familyId: string;
  deviceName: string;
  authToken: string;
  enrolledAt: string;
}

export async function saveCredentials(creds: DeviceCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.DEVICE_ID, creds.deviceId),
    SecureStore.setItemAsync(KEYS.FAMILY_ID, creds.familyId),
    SecureStore.setItemAsync(KEYS.DEVICE_NAME, creds.deviceName),
    SecureStore.setItemAsync(KEYS.AUTH_TOKEN, creds.authToken),
    SecureStore.setItemAsync(KEYS.ENROLLED_AT, creds.enrolledAt),
  ]);
}

export async function loadCredentials(): Promise<DeviceCredentials | null> {
  const [deviceId, familyId, deviceName, authToken, enrolledAt] =
    await Promise.all([
      SecureStore.getItemAsync(KEYS.DEVICE_ID),
      SecureStore.getItemAsync(KEYS.FAMILY_ID),
      SecureStore.getItemAsync(KEYS.DEVICE_NAME),
      SecureStore.getItemAsync(KEYS.AUTH_TOKEN),
      SecureStore.getItemAsync(KEYS.ENROLLED_AT),
    ]);

  if (!deviceId || !familyId) return null;

  return {
    deviceId,
    familyId,
    deviceName: deviceName ?? "Unknown device",
    authToken: authToken ?? "",
    enrolledAt: enrolledAt ?? "",
  };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}

export async function isEnrolled(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null;
}
