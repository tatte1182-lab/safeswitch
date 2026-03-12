// SafeSwitch · AddChildEnrollmentFlow.tsx
// Orchestration only — reducer state, slide transitions, no UI logic here.
import React, { useCallback, useReducer, useRef } from "react";
import { Alert, Animated, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StepForm } from "./components/StepForm";
import { StepDeal } from "./components/StepDeal";
import { StepQR } from "./components/StepQR";
import { StepAwaitingAgreement, StepError, StepSuccess, LoadingStep, CommittingStep } from "./components/StepExtras";
import { enrollmentReducer, initialEnrollmentState } from "./state/enrollmentReducer";
import { createEnrollmentDraft, createEnrollmentQr, saveEnrollmentPolicy, cancelEnrollment } from "./services/enrollmentApi";
import { useQrCountdown } from "./hooks/useQrCountdown";
import { useEnrollmentStatus } from "./hooks/useEnrollmentStatus";
import { ChildFormData, EnrollmentStep, Schedule } from "./state/enrollmentTypes";
import { C, W } from "./components/ui";

// Progress bar steps (user-visible only)
const PROGRESS_STEPS: EnrollmentStep[] = ["form", "review", "qr", "awaitingAgreement", "success"];

type Props = {
  authToken: string;
  familyId: string;
  onComplete: (childId: string) => void;
  onDismiss: () => void;
};

export default function AddChildEnrollmentFlow({ authToken, familyId, onComplete, onDismiss }: Props) {
  const [state, dispatch] = useReducer(enrollmentReducer, initialEnrollmentState);
  const abortRef = useRef<AbortController | null>(null);

  // Slide animation — fires on every step change
  const slideX   = useRef(new Animated.Value(0)).current;
  const prevStep = useRef<EnrollmentStep>("form");

  const go = useCallback((action: Parameters<typeof dispatch>[0]) => {
    slideX.setValue(W);
    dispatch(action);
    Animated.timing(slideX, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    prevStep.current = (action as any).type;
  }, []);

  const startRequest = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  };

  // ── Handlers ──────────────────────────────────────────────
  const handleFormNext = useCallback(async (data: ChildFormData) => {
    try {
      go({ type: "FORM_SUBMIT_STARTED", payload: data });
      const draft = await createEnrollmentDraft(authToken, familyId, data, startRequest());
      go({ type: "DRAFT_CREATED", payload: draft });
    } catch (e: any) {
      go({ type: "FLOW_ERROR", payload: e?.message ?? "Failed to create enrollment draft" });
    }
  }, [authToken, familyId]);

  const handleSchedulesChange = useCallback((next: Schedule[]) => {
    dispatch({ type: "SCHEDULES_UPDATED", payload: next });
  }, []);

  const handleConfirm = useCallback(async () => {
    try {
      if (!state.enrollmentId) throw new Error("Missing enrollment id");
      go({ type: "SAVE_POLICY_STARTED" });                          // slide once into CommittingStep
      await saveEnrollmentPolicy(authToken, state.enrollmentId, { schedules: state.schedules }, startRequest());
      dispatch({ type: "QR_GENERATION_STARTED" });                  // silent — already on CommittingStep
      const qr = await createEnrollmentQr(authToken, state.enrollmentId, startRequest());
      go({ type: "QR_CREATED", payload: qr });                      // slide into QR screen
    } catch (e: any) {
      go({ type: "FLOW_ERROR", payload: e?.message ?? "Failed to complete enrollment setup" });
    }
  }, [authToken, state.enrollmentId, state.schedules]);

  const handleDeviceDetected = useCallback(() => {
    if (!state.deal?.requiresAgreement) {
      go({ type: "PAIRING_COMPLETED" });
    } else {
      // Both dispatched silently — one single slide happens via go on WAITING_FOR_AGREEMENT
      // but we want zero slides here, just step + status change atomically
      dispatch({ type: "DEVICE_DETECTED" });
      dispatch({ type: "WAITING_FOR_AGREEMENT" });
      // Slide once after both state changes are batched
      slideX.setValue(W);
      Animated.timing(slideX, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }
  }, [state.deal]);

  const handleRegenerate = useCallback(async () => {
    try {
      if (!state.enrollmentId) throw new Error("Missing enrollment id");
      go({ type: "QR_GENERATION_STARTED" });
      const qr = await createEnrollmentQr(authToken, state.enrollmentId, startRequest());
      go({ type: "QR_CREATED", payload: qr });
    } catch (e: any) {
      go({ type: "FLOW_ERROR", payload: e?.message ?? "Failed to generate a new code" });
    }
  }, [authToken, state.enrollmentId]);

  const handleCancelPairing = useCallback(async () => {
    try {
      if (state.enrollmentId) await cancelEnrollment(authToken, state.enrollmentId, startRequest());
      go({ type: "RESET" });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to cancel pairing.");
    }
  }, [authToken, state.enrollmentId]);

  // Agreement polling
  useEnrollmentStatus({
    enabled: state.step === "awaitingAgreement",
    authToken,
    enrollmentId: state.enrollmentId,
    onStatus: (status) => go({ type: "STATUS_UPDATED", payload: status }),
  });

  const { secondsLeft, expired } = useQrCountdown(state.qrExpiresAt);

  // ── Progress ───────────────────────────────────────────────
  const progressIdx = PROGRESS_STEPS.indexOf(state.step as any);

  // ── Render step ────────────────────────────────────────────
  const renderStep = () => {
    switch (state.step) {
      case "form":
        return <StepForm onNext={handleFormNext} />;

      case "creatingDraft":
        return <LoadingStep title="Preparing enrollment…" subtitle="SafeSwitch is creating the draft and loading the default agreement." />;

      case "review":
        return state.childForm && state.deal
          ? <StepDeal
              childData={state.childForm}
              deal={state.deal}
              schedules={state.schedules}
              busy={false}
              onSchedulesChange={handleSchedulesChange}
              onConfirm={handleConfirm}
              onBack={() => go({ type: "BACK_TO_FORM" })}
            />
          : null;

      case "savingPolicy":
      case "generatingQr":
        return <CommittingStep phase={state.step} />;

      case "qr":
        return state.qrToken
          ? <StepQR
              token={state.qrToken}
              secondsLeft={secondsLeft}
              expired={expired}
              requiresAgreement={state.deal?.requiresAgreement ?? false}
              childName={state.childForm?.displayName ?? "Child"}
              onDetected={handleDeviceDetected}
              onRegenerate={handleRegenerate}
              onBack={() => go({ type: "BACK_TO_FORM" })}
            />
          : null;

      case "awaitingAgreement":
        return <StepAwaitingAgreement childName={state.childForm?.displayName ?? "Child"} onCancel={handleCancelPairing} />;

      case "success":
        return state.childForm && state.deal
          ? <StepSuccess childData={state.childForm} deal={state.deal} onDone={() => onComplete(state.childId ?? "")} />
          : null;

      case "error":
        return <StepError message={state.error ?? "Something went wrong."} onReset={() => go({ type: "RESET" })} />;

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Top nav */}
      <View style={s.topNav}>
        <View style={s.navDot} />
        <Text style={s.navTitle}>SafeSwitch</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={{ color: C.textMuted, fontSize: 18 }}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Progress dots */}
      <View style={s.progressRow}>
        {PROGRESS_STEPS.map((_, i) => (
          <View key={i} style={[s.progressDot,
            progressIdx === i && s.progressDotActive,
            progressIdx > i && s.progressDotDone,
          ]} />
        ))}
      </View>

      {/* Animated page */}
      <Animated.View style={{ flex: 1, transform: [{ translateX: slideX }] }}>
        {renderStep()}
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:              { flex: 1, backgroundColor: C.bg },
  topNav:            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.glassBorder },
  navDot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  navTitle:          { color: C.text, fontSize: 15, fontWeight: "800", letterSpacing: 0.8 },
  progressRow:       { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 12 },
  progressDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: C.glassBorder },
  progressDotActive: { width: 20, backgroundColor: C.accent, borderRadius: 3 },
  progressDotDone:   { backgroundColor: C.green },
});
