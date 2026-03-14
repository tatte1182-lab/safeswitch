/* ─────────────────────────────────────────────────────────────
   SafeSwitch — Home Dashboard Screen
   This file is orchestration only:
     - reads theme
     - loads data (mock → swap for real hook)
     - manages scroll/dissolve animation
     - composes card components
   No layout logic, no inline data, no colour literals here.
───────────────────────────────────────────────────────────── */

import React, { useRef, useState, useMemo, useCallback } from "react";
import {
  View, Animated, StatusBar, Modal, TextInput,
  TouchableOpacity, Text, StyleSheet, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme }           from "./theme/useAppTheme";
import { useHouseholdStatus }    from "./hooks/useHouseholdStatus";
import {
  FamilyMap, AttentionCard, QuickActionsCard,
  ChildrenCard, ActivityCard, ProtectionSummaryCard,
  BottomNav,
} from "./components/DashboardCards";
import type { NavTab } from "./components/DashboardCards";

/* ── Layout constants ── */
const SHEET_PEEK = 12; // LOCKED — sheet handle sits flush under Google watermark

/* ── Family ID — comes from auth session in production ── */
const FAMILY_ID = process.env.EXPO_PUBLIC_FAMILY_ID ?? "07635bc4-68c8-4126-bf95-c12c7cfea364";

/* ─────────────────────────────────────────────────────────────
   ADD CHILD SHEET  (self-contained modal, will move to own file)
───────────────────────────────────────────────────────────── */
function AddChildSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useAppTheme();
  const [selAv,  setSelAv]  = useState(0);
  const [selAge, setSelAge] = useState(1);

  const avatarColors = [theme.green, theme.purple, theme.blue, theme.amber, theme.red];
  const avatarLabels = ["A", "B", "C", "D", "E"];
  const ageGroups    = ["5–8", "9–12", "13–15", "16–17"];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
        activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={{
          backgroundColor: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          borderTopWidth: 0.5, borderColor: theme.border, padding: 20, paddingBottom: 40,
        }}>
          <View style={{ width: 36, height: 4, backgroundColor: "rgba(255,255,255,0.15)",
            borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />
          <Text style={{ fontSize: 19, fontWeight: "700", color: theme.text, marginBottom: 4 }}>
            Add a child
          </Text>
          <Text style={{ fontSize: 13, color: theme.textMuted, marginBottom: 22 }}>
            Set up their profile and link devices.
          </Text>

          {/* Avatar picker */}
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", marginBottom: 22 }}>
            {avatarColors.map((col, i) => (
              <TouchableOpacity key={i} onPress={() => setSelAv(i)} style={{
                width: 48, height: 48, borderRadius: 24, backgroundColor: `${col}22`,
                borderWidth: 2, borderColor: selAv === i ? col : "transparent",
                alignItems: "center", justifyContent: "center",
              }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: col }}>{avatarLabels[i]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase",
            letterSpacing: 0.7, marginBottom: 6 }}>Child's name</Text>
          <TextInput
            placeholder="e.g. Emma"
            placeholderTextColor={theme.textMuted}
            style={{ backgroundColor: theme.card, borderWidth: 0.5, borderColor: theme.border,
              borderRadius: 12, padding: 12, color: theme.text, fontSize: 14, marginBottom: 16 }}
          />

          <Text style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase",
            letterSpacing: 0.7, marginBottom: 6 }}>Age group</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 22 }}>
            {ageGroups.map((a, i) => (
              <TouchableOpacity key={i} onPress={() => setSelAge(i)} style={{
                flex: 1, padding: 10, borderRadius: 10, alignItems: "center",
                backgroundColor: selAge === i ? `${theme.blue}1e` : theme.card,
                borderWidth: 0.5, borderColor: selAge === i ? `${theme.blue}80` : theme.border,
              }}>
                <Text style={{ fontSize: 13, color: selAge === i ? theme.blue : theme.textDim }}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={{ backgroundColor: theme.blue, borderRadius: 14,
            padding: 14, alignItems: "center" }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>
              Continue to device setup →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: theme.textMuted }}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD SCREEN
───────────────────────────────────────────────────────────── */
export default function SafeSwitchDashboard() {
  const theme   = useAppTheme();
  const insets  = useSafeAreaInsets();
  const { data, loading, error } = useHouseholdStatus(FAMILY_ID);

  const [activeTab,  setActiveTab]  = useState<NavTab>("Home");
  const [showSheet,  setShowSheet]  = useState(false);

  const MAP_HEIGHT = 338 + insets.top;

  /* ── Scroll → node dissolve ── */
  const scrollY = useRef(new Animated.Value(0)).current;
  const nodeInfoOpacity = useMemo(() => scrollY.interpolate({
    inputRange:  [0, 10, 30],
    outputRange: [1,  1,  0],
    extrapolate: "clamp",
  }), [scrollY]);

  /* ── Handlers ── */
  const handleQuickAction = useCallback((id: string) => {
    console.log("quick action:", id);
    // TODO: wire to Edge Functions — pause-device, extend-time, emergency-checkin
  }, []);

  const handleAlertAction = useCallback((id: string) => {
    console.log("alert action:", id);
    // TODO: wire to alert dismissal RPC
  }, []);

  const handlePause = useCallback((childId: string) => {
    console.log("pause child:", childId);
    // TODO: call pause-device Edge Function
  }, []);

  /* ── Loading state ── */
  if (loading) {
    return (
      <View style={[ss.root, ss.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.green} size="large" />
        <Text style={{ color: theme.textMuted, marginTop: 12, fontSize: 13 }}>
          Connecting to your home network…
        </Text>
      </View>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <View style={[ss.root, ss.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.red, fontSize: 15, fontWeight: "600", marginBottom: 8 }}>
          Could not load dashboard
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: "center", paddingHorizontal: 40 }}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={[ss.root, { backgroundColor: theme.bg }]}>
      <StatusBar
        barStyle={theme.statusBarStyle}
        backgroundColor="transparent"
        translucent
      />

      {/* ── MAP (pinned, behind scroll) ── */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: MAP_HEIGHT }}>
        <FamilyMap
          mapHeight={MAP_HEIGHT}
          children={data.children}
          node={data.node}
          nodeInfoOpacity={nodeInfoOpacity}
          theme={theme}
          insetTop={insets.top}
        />
      </View>

      {/* ── SCROLLABLE SHEET ── */}
      <Animated.ScrollView
        style={{ flex: 1, backgroundColor: "transparent" }}
        contentContainerStyle={{ paddingTop: MAP_HEIGHT - SHEET_PEEK, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
      >
        <View style={{ backgroundColor: "transparent", borderTopLeftRadius: 22,
          borderTopRightRadius: 22, paddingBottom: 8 }}>

          {/* Drag pill */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 8 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2,
              backgroundColor: theme.isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.2)" }} />
          </View>

          <AttentionCard
            alerts={data.pendingAlerts}
            theme={theme}
            onAction={handleAlertAction}
          />

          <QuickActionsCard
            actions={data.quickActions}
            theme={theme}
            onAction={handleQuickAction}
          />

          <ChildrenCard
            children={data.children}
            theme={theme}
            onAddChild={() => setShowSheet(true)}
            onPause={handlePause}
          />

          <ActivityCard
            events={data.recentEvents}
            newCount={3}
            theme={theme}
          />

          <ProtectionSummaryCard
            summary={data.protectionSummary}
            theme={theme}
          />

        </View>
      </Animated.ScrollView>

      {/* ── NAV ── */}
      <BottomNav
        active={activeTab}
        theme={theme}
        insetBottom={insets.bottom}
        onPress={setActiveTab}
      />

      <AddChildSheet visible={showSheet} onClose={() => setShowSheet(false)} />
    </View>
  );
}

const ss = StyleSheet.create({
  root:   { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },
});
