/* ─────────────────────────────────────────────────────────────
   SafeSwitch — theme system
   One source of truth for every colour, text and border token.
   Components import `useAppTheme()` — never read C or THEME directly.
───────────────────────────────────────────────────────────── */

import { useState, useEffect } from "react";

/* ── Brand palette (never used directly in components) ── */
const BRAND = {
  green:  "#1fd98a",
  blue:   "#4ea0ff",
  purple: "#a78bfa",
  amber:  "#f5a623",
  red:    "#f04438",
} as const;

/* ── Map styles ── */
const MAP_NIGHT = [
  { elementType: "geometry",           stylers: [{ color: "#060c18" }] },
  { elementType: "labels.text.fill",   stylers: [{ color: "#4a5568" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#060c18" }] },
  { featureType: "administrative",     elementType: "geometry", stylers: [{ color: "#0d1525" }] },
  { featureType: "landscape",          stylers: [{ color: "#0d1525" }] },
  { featureType: "poi",                stylers: [{ visibility: "off" }] },
  { featureType: "road",               elementType: "geometry", stylers: [{ color: "#0d1a2e" }] },
  { featureType: "road",               elementType: "labels",   stylers: [{ visibility: "off" }] },
  { featureType: "transit",            stylers: [{ visibility: "off" }] },
  { featureType: "water",              stylers: [{ color: "#04080f" }] },
];

const MAP_DAWN = [
  { elementType: "geometry",           stylers: [{ color: "#1a1008" }] },
  { elementType: "labels.text.fill",   stylers: [{ color: "#8a7060" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1008" }] },
  { featureType: "landscape",          stylers: [{ color: "#1e1510" }] },
  { featureType: "poi",                stylers: [{ visibility: "off" }] },
  { featureType: "road",               elementType: "geometry", stylers: [{ color: "#2a1e12" }] },
  { featureType: "road",               elementType: "labels",   stylers: [{ visibility: "off" }] },
  { featureType: "transit",            stylers: [{ visibility: "off" }] },
  { featureType: "water",              stylers: [{ color: "#0e1820" }] },
];

const MAP_DUSK = [
  { elementType: "geometry",           stylers: [{ color: "#0f0e18" }] },
  { elementType: "labels.text.fill",   stylers: [{ color: "#6b6080" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f0e18" }] },
  { featureType: "landscape",          stylers: [{ color: "#13111e" }] },
  { featureType: "poi",                stylers: [{ visibility: "off" }] },
  { featureType: "road",               elementType: "geometry", stylers: [{ color: "#1a1830" }] },
  { featureType: "road",               elementType: "labels",   stylers: [{ visibility: "off" }] },
  { featureType: "transit",            stylers: [{ visibility: "off" }] },
  { featureType: "water",              stylers: [{ color: "#070614" }] },
];

/* ── Token shape ── */
export interface AppTheme {
  // Time slot
  slot: "night" | "dawn" | "day" | "dusk";
  isLight: boolean;

  // Backgrounds
  bg:        string;
  surface:   string;
  card:      string;
  overlayBg: string;

  // Text
  text:      string;
  textDim:   string;
  textMuted: string;

  // Borders
  border:    string;

  // Brand accents (same across themes)
  green:     string;
  blue:      string;
  purple:    string;
  amber:     string;
  red:       string;

  // Mode chip tokens
  mode: Record<"school"|"home"|"bedtime"|"free", {
    label:  string;
    color:  string;
    bg:     string;
    border: string;
  }>;

  // Map
  mapStyle: object[];
  statusBarStyle: "light-content" | "dark-content";
}

/* ── Theme definitions ── */
function buildTheme(slot: AppTheme["slot"]): AppTheme {
  const isLight = slot === "day";

  const base = {
    slot,
    isLight,
    ...BRAND,
    mode: {
      school:  { label: "School",    color: BRAND.blue,   bg: "rgba(78,160,255,0.18)",  border: "rgba(78,160,255,0.4)"  },
      home:    { label: "Home",      color: BRAND.green,  bg: "rgba(31,217,138,0.18)",  border: "rgba(31,217,138,0.4)"  },
      bedtime: { label: "Bedtime",   color: BRAND.purple, bg: "rgba(167,139,250,0.18)", border: "rgba(167,139,250,0.4)" },
      free:    { label: "Free Time", color: BRAND.amber,  bg: "rgba(245,166,35,0.18)",  border: "rgba(245,166,35,0.4)"  },
    },
  };

  if (slot === "day") return {
    ...base,
    bg:              "#f0f2f5",
    surface:         "#ffffff",
    card:            "#f7f8fa",
    overlayBg:       "rgba(240,242,245,0.82)",
    text:            "rgba(0,0,0,0.85)",
    textDim:         "rgba(0,0,0,0.55)",
    textMuted:       "rgba(0,0,0,0.38)",
    border:          "rgba(0,0,0,0.08)",
    mapStyle:        [],   // Google default light
    statusBarStyle:  "dark-content",
  };

  if (slot === "dawn") return {
    ...base,
    bg:              "#13100f",
    surface:         "#1c1612",
    card:            "#16120e",
    overlayBg:       "rgba(19,16,15,0.72)",
    text:            "rgba(255,255,255,0.9)",
    textDim:         "rgba(255,255,255,0.5)",
    textMuted:       "rgba(255,255,255,0.28)",
    border:          "rgba(255,255,255,0.07)",
    mapStyle:        MAP_DAWN,
    statusBarStyle:  "light-content",
  };

  if (slot === "dusk") return {
    ...base,
    bg:              "#0f0e18",
    surface:         "#181624",
    card:            "#12101c",
    overlayBg:       "rgba(15,14,24,0.78)",
    text:            "rgba(255,255,255,0.9)",
    textDim:         "rgba(255,255,255,0.5)",
    textMuted:       "rgba(255,255,255,0.28)",
    border:          "rgba(255,255,255,0.07)",
    mapStyle:        MAP_DUSK,
    statusBarStyle:  "light-content",
  };

  // night (default)
  return {
    ...base,
    bg:              "#0b0d13",
    surface:         "#13161f",
    card:            "#0e1118",
    overlayBg:       "rgba(11,13,19,0.78)",
    text:            "rgba(255,255,255,0.9)",
    textDim:         "rgba(255,255,255,0.5)",
    textMuted:       "rgba(255,255,255,0.28)",
    border:          "rgba(255,255,255,0.07)",
    mapStyle:        MAP_NIGHT,
    statusBarStyle:  "light-content",
  };
}

function getSlot(): AppTheme["slot"] {
  const h = new Date().getHours();
  if (h >= 6  && h < 9)  return "dawn";
  if (h >= 9  && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

/* ── Hook ── */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => buildTheme(getSlot()));

  useEffect(() => {
    const id = setInterval(() => {
      const next = buildTheme(getSlot());
      setTheme(prev => prev.slot === next.slot ? prev : next);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return theme;
}
