import React, { memo, useMemo, useRef, useCallback, useState, useEffect } from "react";
import {
  Alert, Animated, Keyboard, PanResponder,
  Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChildFormData } from "../state/enrollmentTypes";
import { C, H, W, shared } from "./ui";

// ─── Helpers ─────────────────────────────────────────────────
function parseDobStrict(raw: string): string | null {
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd), month = Number(mm), year = Number(yyyy);
  const d = new Date(Date.UTC(year, month - 1, day));
  const valid = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return valid ? `${yyyy}-${mm}-${dd}` : null;
}

function calcAge(iso: string) {
  const b = new Date(iso), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}

// ─── Colour Picker ───────────────────────────────────────────
const CP_W = Math.min(W - 56, 300);
const CP_H = Math.round(CP_W * 0.62);
const HUE_H = 24;

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function ColourPicker({ onChange }: { onChange: (c: string) => void }) {
  const hueRef = useRef(210);
  const sRef   = useRef(0.82);
  const vRef   = useRef(0.9);

  const [hue, setHue] = useState(210);
  const [s,   setS]   = useState(0.82);
  const [v,   setV]   = useState(0.9);

  const dotX   = useRef(new Animated.Value(sRef.current * CP_W)).current;
  const dotY   = useRef(new Animated.Value((1 - vRef.current) * CP_H)).current;
  const huePos = useRef(new Animated.Value((hueRef.current / 360) * CP_W)).current;

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const sbPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: e => {
      const x = clamp(e.nativeEvent.locationX, 0, CP_W);
      const y = clamp(e.nativeEvent.locationY, 0, CP_H);
      sRef.current = x / CP_W; vRef.current = 1 - y / CP_H;
      dotX.setValue(x); dotY.setValue(y);
    },
    onPanResponderMove: e => {
      const x = clamp(e.nativeEvent.locationX, 0, CP_W);
      const y = clamp(e.nativeEvent.locationY, 0, CP_H);
      sRef.current = x / CP_W; vRef.current = 1 - y / CP_H;
      dotX.setValue(x); dotY.setValue(y);
    },
    onPanResponderRelease: () => {
      setS(sRef.current); setV(vRef.current);
      onChange(hsvToHex(hueRef.current, sRef.current, vRef.current));
    },
  })).current;

  const huePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: e => {
      const x = clamp(e.nativeEvent.locationX, 0, CP_W);
      hueRef.current = (x / CP_W) * 360; huePos.setValue(x);
    },
    onPanResponderMove: e => {
      const x = clamp(e.nativeEvent.locationX, 0, CP_W);
      hueRef.current = (x / CP_W) * 360; huePos.setValue(x);
    },
    onPanResponderRelease: () => {
      setHue(hueRef.current);
      onChange(hsvToHex(hueRef.current, sRef.current, vRef.current));
    },
  })).current;

  const pureHue  = hsvToHex(hue, 1, 1);
  const liveColor = hsvToHex(hue, s, v);
  const HUE_COLORS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30},100%,50%)`);

  return (
    <View style={{ gap: 14, alignItems: "center" }}>
      <View style={{ width: CP_W, height: CP_H, borderRadius: 14, overflow: "hidden" }} {...sbPan.panHandlers}>
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: pureHue }} />
        <LinearGradient colors={["#fff", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={["transparent", "#000"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFillObject} />
        <Animated.View pointerEvents="none" style={{
          position: "absolute", width: 22, height: 22, borderRadius: 11,
          borderWidth: 2.5, borderColor: "#fff",
          shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 4,
          transform: [
            { translateX: Animated.add(dotX, new Animated.Value(-11)) },
            { translateY: Animated.add(dotY, new Animated.Value(-11)) },
          ],
        }} />
      </View>

      <View style={{ width: CP_W, height: HUE_H, borderRadius: HUE_H / 2, overflow: "hidden" }} {...huePan.panHandlers}>
        <LinearGradient colors={HUE_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
        <Animated.View pointerEvents="none" style={{
          position: "absolute", width: HUE_H, height: HUE_H, borderRadius: HUE_H / 2,
          borderWidth: 2.5, borderColor: "#fff", backgroundColor: pureHue,
          shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 4,
          transform: [{ translateX: Animated.add(huePos, new Animated.Value(-HUE_H / 2)) }],
        }} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: liveColor,
          borderWidth: 2, borderColor: "rgba(255,255,255,0.25)",
          shadowColor: liveColor, shadowOpacity: 0.6, shadowRadius: 12,
        }} />
        <Text style={{ color: C.textMuted, fontSize: 12 }}>Drag to pick a colour</Text>
      </View>
    </View>
  );
}

// ─── StepForm ────────────────────────────────────────────────
type Props = {
  onNext: (data: ChildFormData) => Promise<void> | void;
  busy?: boolean;
};

function StepFormImpl({ onNext, busy = false }: Props) {
  const [name,       setName]   = useState("");
  const [dobDisplay, setDobDis] = useState("");
  const [dobError,   setDobErr] = useState("");
  const [dobIso,     setDobIso] = useState<string | null>(null);
  const [color,      setColor]  = useState(hsvToHex(210, 0.82, 0.9));
  const [localBusy,  setLocalBusy] = useState(false);
  const liftAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const LIFT = H * 0.34;
    const show = Keyboard.addListener("keyboardDidShow", () =>
      Animated.timing(liftAnim, { toValue: -LIFT, duration: 280, useNativeDriver: true }).start()
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      Animated.timing(liftAnim, { toValue: 0, duration: 260, useNativeDriver: true }).start()
    );
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handleDob = (text: string) => {
    // Only allow digits and forward slashes
    const raw = text.replace(/[^\d/]/g, "");
    // Auto-insert slashes
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 2) formatted = digits.slice(0, 2) + "/" + digits.slice(2);
    if (digits.length > 4) formatted = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
    setDobDis(formatted);

    const parsed = parseDobStrict(formatted);
    if (digits.length === 8) {
      if (!parsed) { setDobErr("Enter a valid date DD/MM/YYYY"); setDobIso(null); return; }
      const age = calcAge(parsed);
      if (age < 3 || age > 18) { setDobErr("Child must be 3–18 years old"); setDobIso(null); return; }
      setDobErr(""); setDobIso(parsed);
    } else {
      setDobErr(""); setDobIso(null);
    }
  };

  const age = dobIso ? calcAge(dobIso) : null;
  const ok = name.trim().length >= 2 && !!dobIso && !dobError;
  const disabled = busy || localBusy || !ok;

  const [nameFocused, setNameFocused] = useState(false);
  const [dobFocused,  setDobFocused]  = useState(false);

  const handleSubmit = async () => {
    if (!dobIso || disabled) return;
    Keyboard.dismiss();
    setLocalBusy(true);
    try {
      await onNext({ displayName: name.trim(), dateOfBirth: dobIso, avatarColor: color });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Please try again.");
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Frozen: title + colour picker */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Text style={shared.stepTitle}>Add a child</Text>
        <Text style={shared.stepSubtitle}>SafeSwitch sets everything up automatically.</Text>
        <View style={[shared.glassCard, { padding: 20 }]}>
          <Text style={shared.fieldLabel}>Avatar colour</Text>
          <ColourPicker onChange={setColor} />
        </View>
      </View>

      {/* Sliding card: name + DOB + CTA */}
      <Animated.View style={[s.card, { transform: [{ translateY: liftAnim }] }]}>
        <Text style={shared.fieldLabel}>Child's name</Text>
        <TextInput
          style={[shared.input, { marginBottom: 16, borderColor: C.glassBorder }]}
          value={name}
          onChangeText={setName}
          placeholder="First name or nickname"
          placeholderTextColor={C.textMuted}
          autoCapitalize="words"
          returnKeyType="done"
          underlineColorAndroid="transparent"
          selectionColor={C.accent}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
        />

        <Text style={shared.fieldLabel}>Date of birth</Text>
        <TextInput
          style={[shared.input, { borderColor: dobError ? C.red + "60" : C.glassBorder }]}
          value={dobDisplay}
          onChangeText={handleDob}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={C.textMuted}
          keyboardType="number-pad"
          maxLength={10}
          underlineColorAndroid="transparent"
          selectionColor={C.accent}
          onFocus={() => setDobFocused(true)}
          onBlur={() => setDobFocused(false)}
        />
        {dobError ? <Text style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{dobError}</Text> : null}
        {age !== null && !dobError ? (
          <View style={shared.agePill}>
            <Text style={shared.agePillTxt}>
              {age}y · {age >= 13 ? "✍ Needs to agree to The Deal" : "✓ Deal auto-activates"}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[shared.primaryBtn, { marginTop: 20 }, disabled && shared.btnDisabled]}
          disabled={disabled}
          onPress={handleSubmit}
          activeOpacity={0.85}
        >
          {busy || localBusy
            ? <Text style={shared.primaryBtnTxt}>Preparing…</Text>
            : <Text style={shared.primaryBtnTxt}>Review The Deal →</Text>
          }
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export const StepForm = memo(StepFormImpl);

const s = StyleSheet.create({
  card: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: C.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: C.glassBorder,
    padding: 24, paddingBottom: 44,
  },
  // Kills the Android blue underline and iOS blue focus ring
  noFocusBorder: {
    // On Android, underlineColorAndroid="transparent" handles it.
    // This ensures no highlight color bleeds through on iOS either.
  },
});
