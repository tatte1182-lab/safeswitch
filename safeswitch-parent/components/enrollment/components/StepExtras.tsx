import React, { memo, useEffect, useRef } from "react";
import { Animated, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { ChildFormData, DealData } from "../state/enrollmentTypes";
import { C, MODE_META, shared } from "./ui";

function fmtMins(m: number | null) {
  if (m === null || m === 0) return "Restricted";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

// ─── Awaiting Agreement ──────────────────────────────────────
type AwaitingProps = { childName: string; onCancel: () => void };

function StepAwaitingImpl({ childName, onCancel }: AwaitingProps) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const animStarted = useRef(false);
  useEffect(() => {
    if (animStarted.current) return;
    animStarted.current = true;
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
    ])).start();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
      <Animated.View style={{ opacity: pulseAnim }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.amber + "20", borderWidth: 2, borderColor: C.amber + "50", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 36 }}>✍</Text>
        </View>
      </Animated.View>

      <View style={{ alignItems: "center", gap: 8 }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>
          Waiting for {childName}
        </Text>
        <Text style={{ color: C.textDim, fontSize: 15, lineHeight: 22, textAlign: "center" }}>
          Their device has been detected.{"\n"}SafeSwitch is waiting for them to review and accept The Deal.
        </Text>
      </View>

      <View style={[shared.glassCard, { padding: 16, width: "100%" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ActivityIndicator color={C.amber} />
          <Text style={{ color: C.amber, fontSize: 14, fontWeight: "600" }}>Agreement pending</Text>
        </View>
        <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 8, lineHeight: 18 }}>
          This screen updates automatically when {childName} accepts or declines.
        </Text>
      </View>

      <TouchableOpacity
        style={[shared.primaryBtn, { width: "100%", backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }]}
        onPress={onCancel}
        activeOpacity={0.85}
      >
        <Text style={[shared.primaryBtnTxt, { color: C.textDim }]}>Cancel pairing</Text>
      </TouchableOpacity>
    </View>
  );
}
export const StepAwaitingAgreement = memo(StepAwaitingImpl);

// ─── Success ─────────────────────────────────────────────────
type SuccessProps = { childData: ChildFormData; deal: DealData; onDone: () => void };

function StepSuccessImpl({ childData, deal, onDone }: SuccessProps) {
  const wireA  = useRef(new Animated.Value(0)).current;
  const floatA = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(wireA, { toValue: 1, duration: 1400, useNativeDriver: false }).start();
    Animated.loop(Animated.sequence([
      Animated.timing(floatA, { toValue: 1, duration: 2200, useNativeDriver: true }),
      Animated.timing(floatA, { toValue: 0, duration: 2200, useNativeDriver: true }),
    ])).start();
  }, []);

  const wireW  = wireA.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const floatY = floatA.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  const rows = [
    { label: "Level",       value: "1 · New recruit", color: C.purple },
    ...deal.schedules.map(sc => ({
      label: MODE_META[sc.mode]?.label ?? sc.mode,
      value: `${sc.start}–${sc.end}  ·  ${fmtMins(sc.screenTimeMinutes)}`,
      color: MODE_META[sc.mode]?.color ?? C.textDim,
    })),
  ];

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={{ alignItems: "center", paddingTop: 32, paddingHorizontal: 24 }}>
        {/* Wire animation */}
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", width: "100%", paddingHorizontal: 8, marginBottom: 28 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <View style={{ width: 76, height: 76, backgroundColor: C.accent + "18", borderRadius: 20, borderWidth: 2, borderColor: C.accent + "50", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 38 }}>🏠</Text>
            </View>
            <Text style={{ color: C.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>HOME NODE</Text>
          </View>
          <View style={{ flex: 1, height: 44, justifyContent: "center", paddingHorizontal: 10 }}>
            <View style={{ width: "100%", height: 2, backgroundColor: C.glassBorder, borderRadius: 1, overflow: "hidden" }}>
              <Animated.View style={{ width: wireW, height: "100%", backgroundColor: C.green }} />
            </View>
          </View>
          <Animated.View style={{ alignItems: "center", gap: 6, transform: [{ translateY: floatY }] }}>
            <View style={{ width: 64, height: 64, backgroundColor: childData.avatarColor + "22", borderRadius: 32, borderWidth: 2, borderColor: childData.avatarColor + "60", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>{childData.displayName[0].toUpperCase()}</Text>
            </View>
            <Text style={{ color: childData.avatarColor, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>{childData.displayName.toUpperCase()}</Text>
          </Animated.View>
        </View>

        <Text style={[shared.stepTitle, { textAlign: "center" }]}>{childData.displayName} is connected</Text>
        <Text style={[shared.stepSubtitle, { textAlign: "center", marginBottom: 28 }]}>
          Their device is routed through your Home Node and protected by SafeSwitch.
        </Text>
      </Animated.View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 40 }}>
        <View style={[shared.glassCard, { padding: 4, marginBottom: 24 }]}>
          {rows.map((row, i) => (
            <View key={i} style={[{ flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, gap: 12 }, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.glassBorder }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
              <Text style={{ color: C.textDim, fontSize: 14, fontWeight: "600", width: 100 }}>{row.label}</Text>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", textAlign: "right", color: row.color }}>{row.value}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[shared.primaryBtn, { width: "100%" }]} onPress={onDone} activeOpacity={0.85}>
          <Text style={shared.primaryBtnTxt}>Go to dashboard →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
export const StepSuccess = memo(StepSuccessImpl);

// ─── Error ───────────────────────────────────────────────────
type ErrorProps = { message: string; onReset: () => void };

function StepErrorImpl({ message, onReset }: ErrorProps) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.red + "18", borderWidth: 2, borderColor: C.red + "40", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 32 }}>⚠️</Text>
      </View>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>Something went wrong</Text>
      <Text style={{ color: C.textDim, fontSize: 15, textAlign: "center", lineHeight: 22 }}>{message}</Text>
      <TouchableOpacity style={[shared.primaryBtn, { width: "100%" }]} onPress={onReset} activeOpacity={0.85}>
        <Text style={shared.primaryBtnTxt}>Start again</Text>
      </TouchableOpacity>
    </View>
  );
}
export const StepError = memo(StepErrorImpl);

// ─── Creating Draft loader ─────────────────────────────────────
type LoadingProps = { title: string; subtitle: string };

function LoadingStepImpl({ title, subtitle }: LoadingProps) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 }}>
      <ActivityIndicator size="large" color={C.accent} />
      <Text style={{ color: C.text, fontSize: 20, fontWeight: "700", textAlign: "center" }}>{title}</Text>
      <Text style={{ color: C.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{subtitle}</Text>
    </View>
  );
}
export const LoadingStep = memo(LoadingStepImpl);

// ─── Committing Step — merged saving + QR generation ──────────
// Shows both tasks on one screen with live status indicators.
type CommittingStepProps = { phase: "savingPolicy" | "generatingQr" };

function CommittingStepImpl({ phase }: CommittingStepProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true })
    ).start();
  }, []);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const tasks = [
    {
      id: "savingPolicy",
      label: "Saving your plan",
      sub: "Schedules and rules are locked in",
    },
    {
      id: "generatingQr",
      label: "Generating pairing code",
      sub: "Creating a short-lived secure token",
    },
  ];

  const activeIdx = tasks.findIndex(t => t.id === phase);

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 32, gap: 28 }}>
      <View style={{ gap: 6 }}>
        <Text style={shared.stepTitle}>Almost there…</Text>
        <Text style={shared.stepSubtitle}>Setting up {"\n"}the pairing code for the child device.</Text>
      </View>

      <View style={[shared.glassCard, { padding: 4 }]}>
        {tasks.map((task, i) => {
          const done    = i < activeIdx;
          const active  = i === activeIdx;
          const pending = i > activeIdx;

          return (
            <View
              key={task.id}
              style={[
                {
                  flexDirection: "row", alignItems: "center",
                  paddingVertical: 18, paddingHorizontal: 20, gap: 16,
                },
                i < tasks.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.glassBorder },
              ]}
            >
              {/* Status icon */}
              <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
                {done && (
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.green + "20", borderWidth: 1.5, borderColor: C.green, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: C.green, fontSize: 14, fontWeight: "800" }}>✓</Text>
                  </View>
                )}
                {active && (
                  <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <ActivityIndicator size="small" color={C.accent} />
                  </Animated.View>
                )}
                {pending && (
                  <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: C.glassBorder }} />
                )}
              </View>

              {/* Labels */}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{
                  fontSize: 15, fontWeight: "700",
                  color: done ? C.green : active ? C.text : C.textMuted,
                }}>
                  {task.label}
                </Text>
                <Text style={{ fontSize: 13, color: C.textMuted, lineHeight: 18 }}>
                  {task.sub}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
export const CommittingStep = memo(CommittingStepImpl);
