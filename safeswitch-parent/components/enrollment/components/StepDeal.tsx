import React, { memo, useRef, useState } from "react";
import {
  Animated, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, ActivityIndicator,
} from "react-native";
import { ChildFormData, DealData, Schedule } from "../state/enrollmentTypes";
import { C, DAY_LABELS, MODE_META, shared } from "./ui";

function fmtMins(m: number | null) {
  if (m === null || m === 0) return "Restricted";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

function dayLabel(days: number[]): string {
  if (!days?.length) return "No days";
  const s = [...days].sort((a, b) => a - b);
  if (s.length === 7) return "Every day";
  if ([1, 2, 3, 4, 5].every(d => s.includes(d)) && !s.includes(0) && !s.includes(6)) return "Mon – Fri";
  if (s.length === 2 && s.includes(0) && s.includes(6)) return "Sat & Sun";
  return s.map(d => DAY_LABELS[d]).join(", ");
}

type Props = {
  childData: ChildFormData;
  deal: DealData;
  schedules: Schedule[];
  busy: boolean;
  onSchedulesChange: (next: Schedule[]) => void;
  onConfirm: () => Promise<void> | void;
  onBack: () => void;
};

function StepDealImpl({ childData, deal, schedules, busy, onSchedulesChange, onConfirm, onBack }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const anims = useRef<Record<string, Animated.Value>>({});

  schedules.forEach(sc => {
    if (!anims.current[sc.id]) anims.current[sc.id] = new Animated.Value(0);
  });

  const toggle = (id: string) => {
    const closing = openId === id;
    schedules.forEach(sc => {
      Animated.spring(anims.current[sc.id], {
        toValue: sc.id === id && !closing ? 1 : 0,
        tension: 80, friction: 14, useNativeDriver: false,
      }).start();
    });
    setOpenId(closing ? null : id);
  };

  const toggleDay = (id: string, day: number) => {
    onSchedulesChange(schedules.map(sc => {
      if (sc.id !== id) return sc;
      const exists = sc.days.includes(day);
      return { ...sc, days: exists ? sc.days.filter(d => d !== day) : [...sc.days, day].sort((a, b) => a - b) };
    }));
  };

  const setScreenTime = (id: string, v: number) => {
    onSchedulesChange(schedules.map(sc => sc.id === id ? { ...sc, screenTimeMinutes: v } : sc));
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={shared.header}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={{ color: C.accent, fontSize: 22, fontWeight: "300", lineHeight: 26 }}>{"<"}</Text>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: "700" }}>The Deal</Text>
        </TouchableOpacity>
        {deal.requiresAgreement && (
          <View style={{ backgroundColor: C.amber + "12", borderWidth: 1, borderColor: C.amber + "40", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text style={{ color: C.amber, fontSize: 11, fontWeight: "700" }}>Needs agreement</Text>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Child summary */}
        <View style={[shared.glassCard, { padding: 16, marginBottom: 20, flexDirection: "row", alignItems: "center", gap: 14 }]}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: childData.avatarColor, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>{childData.displayName[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: "700" }}>{childData.displayName}</Text>
            <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 2 }}>{deal.headline}</Text>
          </View>
        </View>

        <Text style={[shared.sectionLabel, { marginBottom: 14 }]}>Schedules · tap to edit</Text>

        {schedules.map(sched => {
          const meta = MODE_META[sched.mode] ?? { label: sched.mode, emoji: "⏰", color: C.textDim };
          const editH = anims.current[sched.id]?.interpolate({ inputRange: [0, 1], outputRange: [0, sched.mode === "free" ? 280 : 230] });
          const rot   = anims.current[sched.id]?.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });

          return (
            <View key={sched.id} style={[s.schedCard, { borderColor: meta.color + "28", marginBottom: 12 }]}>
              <TouchableOpacity onPress={() => toggle(sched.id)} activeOpacity={0.85}>
                <View style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: meta.color + "20", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 22 }}>{meta.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: meta.color, marginBottom: 2 }}>{meta.label}</Text>
                    <Text style={{ color: C.textDim, fontSize: 13 }}>{sched.start} – {sched.end}</Text>
                    <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 1 }}>{dayLabel(sched.days)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: meta.color }}>{fmtMins(sched.screenTimeMinutes)}</Text>
                    <Animated.Text style={{ color: C.textMuted, fontSize: 14, transform: [{ rotate: rot ?? "0deg" }] }}>⌄</Animated.Text>
                  </View>
                </View>
              </TouchableOpacity>

              <Animated.View style={{ height: editH, overflow: "hidden" }}>
                <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: meta.color + "20", gap: 16 }}>
                  {/* Days */}
                  <View>
                    <Text style={shared.editorLabel}>Active days</Text>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {DAY_LABELS.map((d, di) => {
                        const active = sched.days.includes(di);
                        return (
                          <TouchableOpacity key={d}
                            onPress={() => toggleDay(sched.id, di)}
                            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: active ? meta.color : "transparent", borderWidth: 1, borderColor: active ? meta.color : C.glassBorder, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: active ? C.bg : C.textMuted, fontSize: 11, fontWeight: "700" }}>{d}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Screen time chips for free mode */}
                  {sched.mode === "free" && (
                    <View>
                      <Text style={shared.editorLabel}>Daily screen time</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {[60, 90, 120, 150, 180, 240].map(v => (
                          <TouchableOpacity key={v}
                            onPress={() => setScreenTime(sched.id, v)}
                            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: sched.screenTimeMinutes === v ? meta.color : C.glassBorder, backgroundColor: sched.screenTimeMinutes === v ? meta.color : "transparent" }}>
                            <Text style={{ color: sched.screenTimeMinutes === v ? C.bg : C.textMuted, fontSize: 12, fontWeight: "600" }}>{fmtMins(v)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </Animated.View>
            </View>
          );
        })}

        <TouchableOpacity
          style={[shared.primaryBtn, { marginTop: 8 }, busy && shared.btnDisabled]}
          onPress={onConfirm}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color={C.bg} />
            : <Text style={shared.primaryBtnTxt}>{deal.requiresAgreement ? "Send Deal + Show QR →" : "Activate + Show QR →"}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

export const StepDeal = memo(StepDealImpl);

const s = StyleSheet.create({
  schedCard: {
    backgroundColor: C.glass,
    borderWidth: 1, borderRadius: 20, overflow: "hidden",
  },
});
