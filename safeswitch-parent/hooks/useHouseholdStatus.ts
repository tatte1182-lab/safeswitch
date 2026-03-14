/* ─────────────────────────────────────────────────────────────
   SafeSwitch — useHouseholdStatus
   Live Supabase data hook.
───────────────────────────────────────────────────────────── */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { HouseholdStatus, ChildRecord, HomeNodeStatus, PendingAlert } from "../types/dashboard.types";
import { MOCK_HOUSEHOLD } from "../mock/dashboard.mock";

const RED    = "#f04438";
const AMBER  = "#f5a623";
const GREEN  = "#1fd98a";
const BLUE   = "#4ea0ff";
const PURPLE = "#a78bfa";

function avatarColorForIndex(i: number): string {
  return [GREEN, PURPLE, BLUE, AMBER, RED][i % 5];
}

interface DeviceRow {
  id: string;
  family_id: string;
  display_name: string | null;
  platform: string | null;
  trust_state: string | null;
  wireguard_ip: string | null;
  assigned_node_id: string | null;
  last_seen_at: string | null;
  mode?: string;
  battery_percent?: number;
  latitude?: number | null;
  longitude?: number | null;
  location_label?: string | null;
}

function toNodeStatus(row: any): HomeNodeStatus {
  if (!row) return { status: "offline", latencyMs: 0, protectionActive: false, filteringActive: false, deviceCount: 0 };
  const isOnline = row.is_online === true;
  return {
    status:           isOnline ? "online" : "offline",
    latencyMs:        row.last_seen_at
      ? Math.round((Date.now() - new Date(row.last_seen_at).getTime()) / 1000)
      : 0,
    protectionActive: isOnline,
    filteringActive:  isOnline,
    deviceCount:      0,
  };
}

function toChildren(rows: DeviceRow[]): ChildRecord[] {
  return rows.map((d, i) => {
    const name  = d.display_name ?? `Device ${i + 1}`;
    return {
      id:            d.id,
      name,
      initial:       name.charAt(0).toUpperCase(),
      avatarColor:   avatarColorForIndex(i),
      latitude:      d.latitude  ?? -33.8688,
      longitude:     d.longitude ?? 151.2093,
      locationLabel: d.location_label ?? (d.wireguard_ip ? "Connected" : "Unknown"),
      mode:          (d.mode as any) ?? "home",
      online:        !!d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 120_000,
      device: {
        name:           d.platform === "ios" ? "iPhone" : d.platform === "android" ? "Android" : "Device",
        platform:       (d.platform as any) ?? "ios",
        batteryPercent: d.battery_percent ?? 100,
      },
    };
  });
}

function buildAlerts(children: ChildRecord[], nodeStatus: HomeNodeStatus): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  if (nodeStatus.status === "offline") {
    alerts.push({ id: "node-offline", severity: "critical", title: "Home Node offline",
      subtitle: "Your family is unprotected", actionLabel: "Check", accentColor: RED });
  }
  children.forEach(child => {
    if (child.device.batteryPercent < 20) {
      alerts.push({ id: `battery-${child.id}`, severity: "warning",
        title: `Low battery · ${child.device.batteryPercent}%`,
        subtitle: `${child.name}'s ${child.device.name}`,
        actionLabel: "Notify", accentColor: AMBER });
    }
  });
  return alerts;
}

async function fetchNodeStatus(familyId: string): Promise<any> {
  const { data, error } = await supabase
    .rpc("get_node_status", { p_family_id: familyId });

  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function useHouseholdStatus(familyId: string): {
  data: HouseholdStatus;
  loading: boolean;
  error: string | null;
} {
  const [data,    setData]    = useState<HouseholdStatus>(MOCK_HOUSEHOLD);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const nodeRef    = useRef<any>(null);
  const devicesRef = useRef<DeviceRow[]>([]);

  const rebuild = useCallback(() => {
    const nodeStatus = toNodeStatus(nodeRef.current);
    const children   = toChildren(devicesRef.current);
    nodeStatus.deviceCount = children.length;
    setData(prev => ({
      ...prev,
      node:          nodeStatus,
      children,
      pendingAlerts: buildAlerts(children, nodeStatus),
      recentEvents:  prev.recentEvents,
      quickActions:  prev.quickActions,
      protectionSummary: {
        ...prev.protectionSummary,
        kidsOnline: children.filter(c => c.online).length,
      },
    }));
  }, []);

  useEffect(() => {
    if (!familyId) return;

    async function fetchInitial() {
      setLoading(true);
      setError(null);
      try {
        nodeRef.current = await fetchNodeStatus(familyId);

        const { data: deviceRows, error: devErr } = await supabase
          .from("devices")
          .select("id, family_id, display_name, platform, trust_state, wireguard_ip, assigned_node_id, last_seen_at")
          .eq("family_id", familyId)
          .eq("trust_state", "enrolled");

        if (devErr) throw devErr;
        devicesRef.current = deviceRows ?? [];
        rebuild();
      } catch (e: any) {
        setError(e.message ?? "Failed to load household status");
      } finally {
        setLoading(false);
      }
    }

    fetchInitial();
  }, [familyId, rebuild]);

  useEffect(() => {
    if (!familyId) return;

    const channel = supabase
      .channel(`household:${familyId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "nodes",
        filter: `family_id=eq.${familyId}`,
      }, async () => {
        nodeRef.current = await fetchNodeStatus(familyId);
        rebuild();
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "devices",
        filter: `family_id=eq.${familyId}`,
      }, payload => {
        const updated = payload.new as DeviceRow;
        devicesRef.current = devicesRef.current.map(d =>
          d.id === updated.id ? { ...d, ...updated } : d
        );
        rebuild();
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "node_heartbeats",
      }, async () => {
        nodeRef.current = await fetchNodeStatus(familyId);
        rebuild();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [familyId, rebuild]);

  return { data, loading, error };
}
