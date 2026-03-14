/* ─────────────────────────────────────────────────────────────
   SafeSwitch Dashboard — typed contract
   All data flowing into the dashboard screen must conform
   to these types. Swap mock → real API without touching UI.
───────────────────────────────────────────────────────────── */

export type ChildMode = "school" | "home" | "bedtime" | "free";
export type AlertSeverity = "critical" | "warning" | "info";
export type EventTag = "Threat" | "Filter" | "Location" | "System";
export type NodeStatus = "online" | "degraded" | "offline";

/* ── Node ── */
export interface HomeNodeStatus {
  status: NodeStatus;
  latencyMs: number;
  protectionActive: boolean;
  filteringActive: boolean;
  deviceCount: number;
}

/* ── Child ── */
export interface ChildDevice {
  name: string;
  platform: "ios" | "android";
  batteryPercent: number;
}

export interface ChildRecord {
  id: string;
  name: string;
  initial: string;
  avatarColor: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  mode: ChildMode;
  online: boolean;
  device: ChildDevice;
}

/* ── Alerts (needs attention) ── */
export interface PendingAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  subtitle: string;
  actionLabel: string;
  accentColor: string;
}

/* ── Activity events ── */
export interface RecentEvent {
  id: string;
  icon: string;
  title: string;
  who: string;
  timeLabel: string;
  tag: EventTag;
  color: string;
}

/* ── Quick actions ── */
export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  sublabel: string;
  actionLabel: string;
  accentColor: string;
}

/* ── Protection summary ── */
export interface ProtectionSummary {
  threatsBlocked: number;
  sitesFiltered: number;
  screenTimeLabel: string;   // e.g. "4h 2m"
  kidsOnline: number;
  insightText: string;
}

/* ── Top-level household status ── */
export interface HouseholdStatus {
  node: HomeNodeStatus;
  children: ChildRecord[];
  pendingAlerts: PendingAlert[];
  recentEvents: RecentEvent[];
  quickActions: QuickAction[];
  protectionSummary: ProtectionSummary;
}
