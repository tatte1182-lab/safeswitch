/* ─────────────────────────────────────────────────────────────
   SafeSwitch Dashboard — mock data adapter
   Replace this file's exports with real API calls.
   Shape must always satisfy HouseholdStatus.
───────────────────────────────────────────────────────────── */

import type { HouseholdStatus } from "../types/dashboard.types";

// Accent colours — imported here so mock stays in sync with theme
const RED    = "#f04438";
const AMBER  = "#f5a623";
const GREEN  = "#1fd98a";
const BLUE   = "#4ea0ff";
const PURPLE = "#a78bfa";

export const HOME_COORD = { latitude: -33.8688, longitude: 151.2093 };

export const MOCK_HOUSEHOLD: HouseholdStatus = {

  node: {
    status: "online",
    latencyMs: 12,
    protectionActive: true,
    filteringActive: true,
    deviceCount: 5,
  },

  children: [
    {
      id: "jamie",
      name: "Jamie",
      initial: "J",
      avatarColor: GREEN,
      latitude: -33.872,
      longitude: 151.044,
      locationLabel: "Liverpool, Sydney",
      mode: "school",
      online: true,
      device: { name: "iPhone 13", platform: "ios", batteryPercent: 72 },
    },
    {
      id: "noah",
      name: "Noah",
      initial: "N",
      avatarColor: PURPLE,
      latitude: 51.5074,
      longitude: -0.1278,
      locationLabel: "London, UK",
      mode: "school",
      online: true,
      device: { name: "iPhone 14", platform: "ios", batteryPercent: 38 },
    },
    {
      id: "mia",
      name: "Mia",
      initial: "M",
      avatarColor: BLUE,
      latitude: -33.869,
      longitude: 151.211,
      locationLabel: "Home",
      mode: "home",
      online: true,
      device: { name: "iPhone 12", platform: "ios", batteryPercent: 91 },
    },
  ],

  pendingAlerts: [
    {
      id: "alert-1",
      severity: "critical",
      title: "Phishing site blocked",
      subtitle: "Noah · 12 min ago",
      actionLabel: "Review",
      accentColor: RED,
    },
    {
      id: "alert-2",
      severity: "warning",
      title: "Low battery · 38%",
      subtitle: "Noah's iPhone · away from home",
      actionLabel: "Notify",
      accentColor: AMBER,
    },
  ],

  recentEvents: [
    { id: "e1", icon: "🚫", title: "Phishing site blocked",    who: "Noah",      timeLabel: "12m ago", tag: "Threat",   color: RED   },
    { id: "e2", icon: "🚫", title: "Adult content blocked",    who: "Noah",      timeLabel: "34m ago", tag: "Filter",   color: RED   },
    { id: "e3", icon: "📍", title: "Arrived at Liverpool Mall", who: "Jamie",    timeLabel: "1h ago",  tag: "Location", color: GREEN },
    { id: "e4", icon: "ℹ️", title: "Node firmware updated",    who: "Home Node", timeLabel: "3h ago",  tag: "System",   color: BLUE  },
    { id: "e5", icon: "🎮", title: "Gaming site blocked",      who: "Jamie",     timeLabel: "5h ago",  tag: "Filter",   color: AMBER },
  ],

  quickActions: [
    {
      id: "pause-all",
      icon: "⏸",
      label: "Pause All Devices",
      sublabel: "Instantly block traffic for every child",
      actionLabel: "Pause",
      accentColor: RED,
    },
    {
      id: "extend-time",
      icon: "⏱",
      label: "Extend Screen Time",
      sublabel: "Add 30 mins to active schedule",
      actionLabel: "+30m",
      accentColor: AMBER,
    },
    {
      id: "checkin",
      icon: "📲",
      label: "Emergency Check-in",
      sublabel: "Send \"Are you OK?\" to all children now",
      actionLabel: "Send",
      accentColor: BLUE,
    },
  ],

  protectionSummary: {
    threatsBlocked: 14,
    sitesFiltered: 138,
    screenTimeLabel: "4h 2m",
    kidsOnline: 3,
    insightText: "Noah had the most blocks today — mostly ad networks and adult content.",
  },
};
