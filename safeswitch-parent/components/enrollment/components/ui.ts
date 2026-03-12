import { Dimensions, StyleSheet } from "react-native";

export const { width: W, height: H } = Dimensions.get("window");

export const C = {
  bg: "#060910", surface: "#0d1117",
  accent: "#00c8ff", green: "#00e5a0", amber: "#ffb800",
  red: "#ff4757", purple: "#a855f7",
  text: "#e8edf8", textDim: "#7a8aa8", textMuted: "#3d4d6a",
  glass: "rgba(255,255,255,0.06)", glassBorder: "rgba(255,255,255,0.10)",
};

export const MODE_META: Record<string, { label: string; emoji: string; color: string }> = {
  school:   { label: "School",    emoji: "🏫", color: C.accent  },
  homework: { label: "Homework",  emoji: "📚", color: C.purple  },
  bedtime:  { label: "Bedtime",   emoji: "🌙", color: "#6366f1" },
  free:     { label: "Free Time", emoji: "🎮", color: C.green   },
};

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const shared = StyleSheet.create({
  stepTitle:    { color: C.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, marginBottom: 8 },
  stepSubtitle: { color: C.textDim, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  fieldLabel:   { color: C.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 14, padding: 16,
    color: C.text, fontSize: 16,
    // Kill Android focus highlight/outline entirely
    outlineStyle: "none" as any,
  },
  primaryBtn:    { backgroundColor: C.accent, borderRadius: 18, padding: 18, alignItems: "center" as const },
  btnDisabled:   { opacity: 0.35 },
  primaryBtnTxt: { color: C.bg, fontSize: 16, fontWeight: "800" as const },
  glassCard: {
    backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 20, overflow: "hidden" as const,
  },
  header: {
    flexDirection: "row" as const, alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.glassBorder,
  },
  sectionLabel: { color: C.textMuted, fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 1 },
  editorLabel:  { color: C.textMuted, fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8, textTransform: "uppercase" as const, marginBottom: 10 },
  agePill:    { backgroundColor: C.accent + "18", borderWidth: 1, borderColor: C.accent + "30", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, alignSelf: "flex-start" as const, marginTop: 10 },
  agePillTxt: { color: C.accent, fontSize: 12, fontWeight: "600" as const },
});
