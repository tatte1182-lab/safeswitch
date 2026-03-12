import React, { memo, useEffect, useRef } from "react";
import { Animated, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { C, W, shared } from "./ui";

// Real QR: uses react-native-qrcode-svg if available, falls back to visual placeholder
let QRCode: any = null;
try { QRCode = require("react-native-qrcode-svg").default; } catch {}

function QRDisplay({ token, size = 210 }: { token: string; size?: number }) {
  if (QRCode) {
    return (
      <View style={{ backgroundColor: "#fff", padding: 16, borderRadius: 16 }}>
        <QRCode value={JSON.stringify({ v: 1, token })} size={size} />
      </View>
    );
  }
  // Fallback visual placeholder
  const cells = 21, cs = size / cells;
  const black = (r: number, c: number) => {
    if (r < 7 && c < 7) return r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    if (r < 7 && c > cells - 8) return r === 0 || r === 6 || c === cells - 1 || c === cells - 7 || (r >= 2 && r <= 4 && c >= cells - 5 && c <= cells - 3);
    if (r > cells - 8 && c < 7) return r === cells - 1 || r === cells - 7 || c === 0 || c === 6 || (r >= cells - 5 && r <= cells - 3 && c >= 2 && c <= 4);
    return (r * 31 + c * 17 + token.charCodeAt(r % token.length)) % 3 === 0;
  };
  return (
    <View style={{ width: size, height: size, backgroundColor: "#fff", padding: 8, borderRadius: 16 }}>
      {Array.from({ length: cells }).map((_, r) => (
        <View key={r} style={{ flexDirection: "row" }}>
          {Array.from({ length: cells }).map((_, c) => (
            <View key={c} style={{ width: cs, height: cs, backgroundColor: black(r, c) ? "#000" : "#fff" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function fmtSecs(total: number) {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Props = {
  token: string;
  secondsLeft: number;
  expired: boolean;
  requiresAgreement: boolean;
  childName: string;
  onDetected: () => void;
  onRegenerate: () => void;
  onBack: () => void;
};

function StepQRImpl({ token, secondsLeft, expired, requiresAgreement, childName, onDetected, onRegenerate, onBack }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.03, duration: 1800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 1800, useNativeDriver: true }),
    ])).start();
  }, []);

  const urgent = secondsLeft < 120;
  const totalSecs = 15 * 60;
  const pct = secondsLeft / totalSecs;

  const steps = requiresAgreement
    ? [`${childName} scans the code`, "They review The Deal", "You'll see their response here"]
    : [`${childName} scans the code`, "Device connects in seconds", "They appear live on your dashboard"];

  return (
    <View style={{ flex: 1 }}>
      <View style={shared.header}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: C.accent, fontSize: 22, fontWeight: "300", lineHeight: 26 }}>{"<"}</Text>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: "700" }}>QR Code</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ alignItems: "center", padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[shared.stepTitle, { textAlign: "center" }]}>Scan this code</Text>
        <Text style={[shared.stepSubtitle, { textAlign: "center" }]}>
          Hand {childName}'s phone to them.{"\n"}Open SafeSwitch → tap "Pair device".
        </Text>

        <Animated.View style={{ transform: [{ scale: pulseAnim }], marginVertical: 20 }}>
          <View style={[shared.glassCard, { padding: 16 }]}>
            <QRDisplay token={token} />
          </View>
        </Animated.View>

        {/* Countdown bar */}
        <View style={[shared.glassCard, { width: W - 80, marginBottom: 24, overflow: "hidden" }]}>
          <View style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${pct * 100}%`,
            backgroundColor: urgent ? C.red : C.accent, opacity: 0.15,
          }} />
          <Text style={[{ color: C.textDim, fontSize: 14, fontWeight: "600", textAlign: "center", padding: 11 }, urgent && { color: C.red }]}>
            {expired ? "⚠ Code expired" : `${urgent ? "⚠ " : "⏱ "}Expires in ${fmtSecs(secondsLeft)}`}
          </Text>
        </View>

        {/* Steps */}
        <View style={[shared.glassCard, { width: "100%", padding: 20, marginBottom: 16 }]}>
          <Text style={[shared.sectionLabel, { marginBottom: 14 }]}>What happens next</Text>
          {steps.map((txt, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent + "20", borderWidth: 1, borderColor: C.accent + "40", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: "800" }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, color: C.textDim, fontSize: 14, lineHeight: 20 }}>{txt}</Text>
            </View>
          ))}
        </View>

        {/* Simulate / Regenerate */}
        <TouchableOpacity style={{ padding: 14 }} onPress={onDetected}>
          <Text style={{ color: C.textMuted, fontSize: 13 }}>Simulate device connected →</Text>
        </TouchableOpacity>

        {expired && (
          <TouchableOpacity
            style={[shared.primaryBtn, { width: "100%", backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }]}
            onPress={onRegenerate}
          >
            <Text style={[shared.primaryBtnTxt, { color: C.textDim }]}>Regenerate QR</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

export const StepQR = memo(StepQRImpl);
