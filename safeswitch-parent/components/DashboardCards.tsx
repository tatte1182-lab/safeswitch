/* ─────────────────────────────────────────────────────────────
   SafeSwitch — dashboard card components
   Each component is pure: receives typed props, reads theme,
   renders nothing else. No inline data, no global C references.
───────────────────────────────────────────────────────────── */

import React, { useRef, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, Animated, StyleSheet,
} from "react-native";
import Svg, { Path, Polyline, Rect, Circle } from "react-native-svg";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import type { AppTheme } from "../theme/useAppTheme";
import type {
  HomeNodeStatus, ChildRecord, PendingAlert,
  RecentEvent, QuickAction, ProtectionSummary,
} from "../types/dashboard.types";

const HOME_COORD = { latitude: -33.8688, longitude: 151.2093 };

/* ════════════════════════════════════════════
   ATOMS
════════════════════════════════════════════ */

export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 1,    duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <Animated.View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, opacity: anim,
    }} />
  );
}

export function ShieldIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2L3 6v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V6Z"
        stroke={color} strokeWidth="1.5" />
      <Polyline points="9,12 11,14 15,10"
        stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ModePill({ mode, theme }: { mode: string; theme: AppTheme }) {
  const m = theme.mode[mode as keyof typeof theme.mode] ?? theme.mode.home;
  return (
    <View style={[cs.pill, { backgroundColor: m.bg, borderColor: m.border }]}>
      <Text style={[cs.pillTxt, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

function CardShell({
  children, theme, style,
}: { children: React.ReactNode; theme: AppTheme; style?: object }) {
  return (
    <View style={[cs.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      {children}
    </View>
  );
}

function CardHeader({
  title, action, theme, left,
}: { title?: string; action?: string; theme: AppTheme; left?: React.ReactNode }) {
  return (
    <View style={cs.cardHeader}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {left}
        {title && <Text style={[cs.cardTitle, { color: theme.textMuted }]}>{title}</Text>}
      </View>
      {action && <Text style={[cs.cardAction, { color: theme.blue }]}>{action}</Text>}
    </View>
  );
}

/* ════════════════════════════════════════════
   MAP MARKERS
════════════════════════════════════════════ */

function HomeMarker({ theme }: { theme: AppTheme }) {
  return (
    <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: 48, height: 48, borderRadius: 24,
        backgroundColor: "rgba(78,160,255,0.1)", borderWidth: 1.5, borderColor: "rgba(78,160,255,0.5)" }} />
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "#0a1830",
        borderWidth: 1.5, borderColor: "rgba(78,160,255,0.9)", alignItems: "center", justifyContent: "center" }}>
        <Svg width="13" height="12" viewBox="0 0 18 15" fill="none">
          <Polyline points="3,8 3,13 8,13 8,8" stroke={theme.blue} strokeWidth="1.5" strokeLinejoin="round" />
          <Polyline points="0,8.5 9,1 18,8.5" stroke={theme.blue} strokeWidth="1.5" strokeLinejoin="round" />
          <Rect x="5.5" y="9" width="4" height="4" rx="0.7" fill={theme.blue} fillOpacity="0.45" />
        </Svg>
      </View>
    </View>
  );
}

function ChildMapMarker({ child, theme }: { child: ChildRecord; theme: AppTheme }) {
  const m = theme.mode[child.mode] ?? theme.mode.home;
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: m.bg,
        borderWidth: 2, borderColor: m.border, alignItems: "center", justifyContent: "center",
        shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: m.color }}>{child.initial}</Text>
      </View>
      <Text style={{ fontSize: 9, fontWeight: "600", color: m.color, marginTop: 2,
        textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}>
        {child.name}
      </Text>
    </View>
  );
}

/* ════════════════════════════════════════════
   FAMILY MAP
════════════════════════════════════════════ */

interface FamilyMapProps {
  mapHeight: number;
  children: ChildRecord[];
  node: HomeNodeStatus;
  nodeInfoOpacity: Animated.AnimatedInterpolation<number>;
  theme: AppTheme;
  insetTop: number;
}

export function FamilyMap({ mapHeight, children, node, nodeInfoOpacity, theme, insetTop }: FamilyMapProps) {
  const mapRef = useRef<MapView>(null);

  const allCoords = useMemo(() => [
    HOME_COORD,
    ...children.map(c => ({ latitude: c.latitude, longitude: c.longitude })),
  ], [children]);

  return (
    <View style={{ height: mapHeight, position: "relative" }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={theme.mapStyle as any}
        initialRegion={{ latitude: -33.8688, longitude: 151.2093, latitudeDelta: 0.5, longitudeDelta: 0.5 }}
        onMapReady={() => mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 130, right: 50, bottom: 60, left: 50 }, animated: false,
        })}
        scrollEnabled={false} zoomEnabled={false} rotateEnabled={false}
        pitchEnabled={false} moveOnMarkerPress={false}
      >
        <Marker coordinate={HOME_COORD} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <HomeMarker theme={theme} />
        </Marker>
        {children.map(child => (
          <Marker key={child.id}
            coordinate={{ latitude: child.latitude, longitude: child.longitude }}
            anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <ChildMapMarker child={child} theme={theme} />
          </Marker>
        ))}
      </MapView>

      {/* Dissolving node overlay */}
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0,
        paddingTop: insetTop, opacity: nodeInfoOpacity }}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 110,
          backgroundColor: theme.overlayBg }} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end",
          paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8, zIndex: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <PulseDot size={6} color={theme.green} />
            <Text style={{ fontSize: 11, color: theme.green, fontWeight: "600" }}>PROTECTED</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 18, paddingBottom: 10, zIndex: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10,
              backgroundColor: "rgba(78,160,255,0.15)", borderWidth: 1,
              borderColor: "rgba(78,160,255,0.4)", alignItems: "center", justifyContent: "center" }}>
              <Svg width="14" height="13" viewBox="0 0 18 15" fill="none">
                <Polyline points="3,8 3,13 8,13 8,8" stroke={theme.blue} strokeWidth="1.5" strokeLinejoin="round" />
                <Polyline points="0,8.5 9,1 18,8.5" stroke={theme.blue} strokeWidth="1.5" strokeLinejoin="round" />
                <Rect x="5.5" y="9" width="4" height="4" rx="0.7" fill={theme.blue} fillOpacity="0.45" />
              </Svg>
            </View>
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <PulseDot size={7} color={theme.green} />
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text, letterSpacing: -0.3 }}>
                  {node.status === "online" ? "Online" : "Degraded"}
                </Text>
              </View>
              <Text style={{ fontSize: 9.5, color: theme.textMuted, marginTop: 1, letterSpacing: 0.5 }}>
                HOME NODE · {node.latencyMs}ms
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 5 }}>
            {node.protectionActive && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 3,
                paddingHorizontal: 7, borderRadius: 999, backgroundColor: "rgba(31,217,138,0.14)",
                borderWidth: 0.5, borderColor: "rgba(31,217,138,0.3)" }}>
                <ShieldIcon size={9} color={theme.green} />
                <Text style={{ fontSize: 9.5, color: theme.green, fontWeight: "500" }}>Protected</Text>
              </View>
            )}
            {node.filteringActive && (
              <View style={{ paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999,
                backgroundColor: "rgba(78,160,255,0.14)", borderWidth: 0.5, borderColor: "rgba(78,160,255,0.25)" }}>
                <Text style={{ fontSize: 9.5, color: "#a8d4ff", fontWeight: "500" }}>Filtering</Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>

      {/* Tap hint */}
      <View style={{ position: "absolute", bottom: 8, left: 0, right: 0, alignItems: "center",
        pointerEvents: "none" } as any}>
        <View style={{ backgroundColor: "rgba(0,0,0,0.3)", paddingVertical: 4, paddingHorizontal: 10,
          borderRadius: 999, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)" }}>
          <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Tap map to expand</Text>
        </View>
      </View>

      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 30,
        backgroundColor: theme.isLight ? "rgba(240,242,245,0.2)" : "rgba(11,13,19,0.25)" }} />
    </View>
  );
}

/* ════════════════════════════════════════════
   ATTENTION CARD
════════════════════════════════════════════ */

interface AttentionCardProps {
  alerts: PendingAlert[];
  theme: AppTheme;
  onDismissAll?: () => void;
  onAction?: (alertId: string) => void;
}

export function AttentionCard({ alerts, theme, onDismissAll, onAction }: AttentionCardProps) {
  if (alerts.length === 0) return null;
  return (
    <CardShell theme={theme} style={{ borderColor: "rgba(240,68,56,0.25)", marginTop: 10 }}>
      <CardHeader
        theme={theme}
        action="Dismiss all"
        left={<>
          <PulseDot size={6} color={theme.red} />
          <Text style={[cs.cardTitle, { color: theme.textMuted }]}>
            NEEDS ATTENTION · {alerts.length}
          </Text>
        </>}
      />
      {alerts.map((alert, i) => (
        <View key={alert.id} style={[cs.alertRow,
          i < alerts.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.05)" }]}>
          <View style={[cs.alertIcon, {
            backgroundColor: `${alert.accentColor}1e`,
            borderColor: `${alert.accentColor}33`,
          }]}>
            <Text style={{ fontSize: 14 }}>{alert.severity === "critical" ? "⚠️" : "🔋"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: theme.text, marginBottom: 2 }}>
              {alert.title}
            </Text>
            <Text style={{ fontSize: 11, color: theme.textMuted }}>{alert.subtitle}</Text>
          </View>
          <TouchableOpacity
            onPress={() => onAction?.(alert.id)}
            style={[cs.alertBtn, {
              borderColor: `${alert.accentColor}4d`,
              backgroundColor: `${alert.accentColor}14`,
            }]}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: alert.accentColor }}>
              {alert.actionLabel}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </CardShell>
  );
}

/* ════════════════════════════════════════════
   QUICK ACTIONS CARD
════════════════════════════════════════════ */

interface QuickActionsCardProps {
  actions: QuickAction[];
  theme: AppTheme;
  onAction?: (actionId: string) => void;
}

export function QuickActionsCard({ actions, theme, onAction }: QuickActionsCardProps) {
  return (
    <CardShell theme={theme} style={{ marginTop: 10, padding: 12 }}>
      <CardHeader title="QUICK ACTIONS" theme={theme} />
      <View style={{ gap: 8 }}>
        {actions.map(action => (
          <TouchableOpacity
            key={action.id}
            onPress={() => onAction?.(action.id)}
            style={{ flexDirection: "row", alignItems: "center",
              backgroundColor: `${action.accentColor}0f`, borderRadius: 14,
              borderWidth: 0.5, borderColor: `${action.accentColor}28`, padding: 14, gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12,
              backgroundColor: `${action.accentColor}20`, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 20 }}>{action.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: theme.text }}>{action.label}</Text>
              <Text style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{action.sublabel}</Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
              backgroundColor: `${action.accentColor}20`, borderWidth: 0.5,
              borderColor: `${action.accentColor}40` }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: action.accentColor }}>
                {action.actionLabel}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </CardShell>
  );
}

/* ════════════════════════════════════════════
   CHILDREN CARD
════════════════════════════════════════════ */

interface ChildrenCardProps {
  children: ChildRecord[];
  theme: AppTheme;
  onAddChild?: () => void;
  onPause?: (childId: string) => void;
}

export function ChildrenCard({ children, theme, onAddChild, onPause }: ChildrenCardProps) {
  return (
    <View style={[cs.card, { marginTop: 10, padding: 0, overflow: "hidden",
      backgroundColor: theme.surface, borderColor: theme.border }]}>
      <CardHeader title="CHILDREN" action="Manage →" theme={theme}
        left={<View style={{ width: 0 }} />} />
      {children.map((child, idx) => {
        const m = theme.mode[child.mode] ?? theme.mode.home;
        const isLast = idx === children.length - 1;
        return (
          <View key={child.id}>
            <View style={{ height: 2, backgroundColor: `${m.color}55`, marginHorizontal: 14 }} />
            <View style={{ paddingHorizontal: 14, paddingVertical: 12,
              backgroundColor: `${m.color}06`,
              borderBottomWidth: isLast ? 0 : 0.5,
              borderBottomColor: "rgba(255,255,255,0.05)" }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20,
                  backgroundColor: m.bg, borderWidth: 2, borderColor: m.border,
                  alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: m.color }}>
                    {child.initial}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: theme.text }}>
                    {child.name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <Text style={{ fontSize: 10 }}>📍</Text>
                    <Text style={{ fontSize: 11, color: theme.textDim }}>{child.locationLabel}</Text>
                  </View>
                </View>
                <ModePill mode={child.mode} theme={theme} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8,
                  paddingHorizontal: 8, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 11 }}>📱</Text>
                  <Text style={{ fontSize: 11, color: theme.textDim, flex: 1 }}>
                    {child.device.name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Text style={{ fontSize: 11 }}>🔋</Text>
                    <Text style={{ fontSize: 11,
                      color: child.device.batteryPercent < 40 ? theme.amber : theme.textDim }}>
                      {child.device.batteryPercent}%
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => onPause?.(child.id)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.05)" }}>
                  <Text style={{ fontSize: 11, fontWeight: "500", color: theme.textDim }}>Pause</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
      <TouchableOpacity
        onPress={onAddChild}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center",
          gap: 8, paddingVertical: 12, borderTopWidth: 0.5,
          borderTopColor: "rgba(255,255,255,0.05)" }}>
        <Text style={{ fontSize: 18, color: theme.textMuted }}>＋</Text>
        <Text style={{ fontSize: 13, fontWeight: "500", color: theme.textMuted }}>Add child</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ════════════════════════════════════════════
   ACTIVITY CARD
════════════════════════════════════════════ */

interface ActivityCardProps {
  events: RecentEvent[];
  newCount: number;
  theme: AppTheme;
  onViewAll?: () => void;
}

export function ActivityCard({ events, newCount, theme, onViewAll }: ActivityCardProps) {
  return (
    <View style={[cs.card, { marginTop: 10, padding: 0,
      backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[cs.cardHeader, { paddingHorizontal: 14, paddingVertical: 14 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[cs.cardTitle, { color: theme.textMuted }]}>ACTIVITY</Text>
          {newCount > 0 && (
            <View style={{ backgroundColor: "rgba(240,68,56,0.15)", paddingHorizontal: 7,
              paddingVertical: 2, borderRadius: 999, borderWidth: 0.5,
              borderColor: "rgba(240,68,56,0.3)" }}>
              <Text style={{ fontSize: 10, fontWeight: "600", color: theme.red }}>{newCount} new</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onViewAll}>
          <Text style={[cs.cardAction, { color: theme.blue }]}>View all →</Text>
        </TouchableOpacity>
      </View>
      {events.map((item, i) => (
        <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 12,
          paddingHorizontal: 14, paddingVertical: 11,
          borderTopWidth: i > 0 ? 0.5 : 0, borderTopColor: "rgba(255,255,255,0.04)" }}>
          <View style={{ width: 36, height: 36, borderRadius: 18,
            backgroundColor: `${item.color}18`, borderWidth: 0.5, borderColor: `${item.color}35`,
            alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Text style={{ fontSize: 15 }}>{item.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: theme.text, marginBottom: 2 }}>
              {item.title}
            </Text>
            <Text style={{ fontSize: 11, color: theme.textMuted }}>{item.who}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 3 }}>
            <View style={{ backgroundColor: `${item.color}18`, paddingHorizontal: 6,
              paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: `${item.color}30` }}>
              <Text style={{ fontSize: 9, fontWeight: "600", color: item.color }}>{item.tag}</Text>
            </View>
            <Text style={{ fontSize: 10, color: theme.textMuted }}>{item.timeLabel}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ════════════════════════════════════════════
   PROTECTION SUMMARY CARD
════════════════════════════════════════════ */

interface ProtectionSummaryCardProps {
  summary: ProtectionSummary;
  theme: AppTheme;
  onViewReport?: () => void;
}

export function ProtectionSummaryCard({ summary, theme, onViewReport }: ProtectionSummaryCardProps) {
  const stats = useMemo(() => [
    { icon: "🚫", value: String(summary.threatsBlocked), label: "Threats",     color: theme.red   },
    { icon: "🔍", value: String(summary.sitesFiltered),  label: "Filtered",    color: theme.amber },
    { icon: "📱", value: summary.screenTimeLabel,         label: "Screen time", color: theme.blue  },
    { icon: "👧", value: String(summary.kidsOnline),      label: "Kids safe",   color: theme.green },
  ], [summary, theme]);

  return (
    <View style={[cs.card, { marginTop: 10, padding: 0, overflow: "hidden",
      backgroundColor: theme.surface, borderColor: theme.border }]}>
      {/* Header band */}
      <View style={{ backgroundColor: "rgba(31,217,138,0.1)", borderBottomWidth: 0.5,
        borderBottomColor: "rgba(31,217,138,0.15)", paddingHorizontal: 14, paddingVertical: 12,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ShieldIcon size={14} color={theme.green} />
          <Text style={{ fontSize: 10, color: theme.green, fontWeight: "700", letterSpacing: 1.2 }}>
            TODAY'S PROTECTION
          </Text>
        </View>
        <TouchableOpacity onPress={onViewReport}>
          <Text style={[cs.cardAction, { color: theme.blue }]}>Full report →</Text>
        </TouchableOpacity>
      </View>

      {/* Narrative headline */}
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme.text, lineHeight: 21, letterSpacing: -0.2 }}>
          SafeSwitch handled{" "}
          <Text style={{ color: theme.red }}>{summary.threatsBlocked} threats</Text>
          {" "}and filtered{" "}
          <Text style={{ color: theme.amber }}>{summary.sitesFiltered} sites</Text>
          {" "}while your kids used{" "}
          <Text style={{ color: theme.blue }}>{summary.screenTimeLabel}</Text>
          {" "}of screen time.
        </Text>
      </View>

      {/* Stat row */}
      <View style={{ flexDirection: "row", paddingHorizontal: 14, paddingBottom: 14, gap: 6 }}>
        {stats.map((stat, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center", paddingVertical: 8,
            backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10,
            borderWidth: 0.5, borderColor: "rgba(255,255,255,0.06)" }}>
            <Text style={{ fontSize: 12 }}>{stat.icon}</Text>
            <Text style={{ fontSize: 13, fontWeight: "700", color: stat.color, marginTop: 3 }}>
              {stat.value}
            </Text>
            <Text style={{ fontSize: 9, color: theme.textMuted, marginTop: 1 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Insight */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 14, paddingVertical: 10,
        borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.05)",
        backgroundColor: "rgba(255,255,255,0.02)" }}>
        <Text style={{ fontSize: 13 }}>💡</Text>
        <Text style={{ fontSize: 12, color: theme.textDim, flex: 1, lineHeight: 17 }}>
          {summary.insightText}
        </Text>
      </View>
    </View>
  );
}

/* ════════════════════════════════════════════
   BOTTOM NAV
════════════════════════════════════════════ */

const NAV_TABS = ["Home", "Children", "Controls", "Activity", "Network"] as const;
export type NavTab = typeof NAV_TABS[number];

interface BottomNavProps {
  active: NavTab;
  theme: AppTheme;
  insetBottom: number;
  onPress: (tab: NavTab) => void;
}

export function BottomNav({ active, theme, insetBottom, onPress }: BottomNavProps) {
  return (
    <View style={[cs.bnav, {
      paddingBottom: insetBottom + 8,
      backgroundColor: theme.bg,
      borderTopColor: theme.border,
    }]}>
      {NAV_TABS.map(tab => (
        <NavItem key={tab} tab={tab} active={tab === active} theme={theme} onPress={onPress} />
      ))}
    </View>
  );
}

function NavItem({ tab, active, theme, onPress }: {
  tab: NavTab; active: boolean; theme: AppTheme; onPress: (t: NavTab) => void;
}) {
  const col = active ? theme.blue : theme.isLight ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.32)";
  return (
    <TouchableOpacity style={cs.navItem} onPress={() => onPress(tab)}>
      <View style={{ width: 20, height: 20 }}>
        <Svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          {tab === "Home" && <>
            <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={col} strokeWidth="1.5" />
            <Polyline points="9,22 9,12 15,12 15,22" stroke={col} strokeWidth="1.5" />
          </>}
          {tab === "Children" && <>
            <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={col} strokeWidth="1.5" />
            <Circle cx="9" cy="7" r="4" stroke={col} strokeWidth="1.5" />
            <Path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke={col} strokeWidth="1.5" />
          </>}
          {tab === "Controls" && <Path d="M12 2L3 6v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V6Z" stroke={col} strokeWidth="1.5" />}
          {tab === "Activity" && <Polyline points="22,12 18,12 15,21 9,3 6,12 2,12" stroke={col} strokeWidth="1.5" strokeLinecap="round" />}
          {tab === "Network" && <>
            <Circle cx="12" cy="12" r="3" stroke={col} strokeWidth="1.5" />
            <Path d="M19.1 5a9.9 9.9 0 0 1 0 14M4.9 5a9.9 9.9 0 0 0 0 14" stroke={col} strokeWidth="1.5" />
            <Path d="M15.5 8.5a5 5 0 0 1 0 7M8.5 8.5a5 5 0 0 0 0 7" stroke={col} strokeWidth="1.5" />
          </>}
        </Svg>
      </View>
      <Text style={[cs.navLabel, { color: col }]}>{tab}</Text>
      {active && <View style={[cs.navPip, { backgroundColor: theme.blue }]} />}
    </TouchableOpacity>
  );
}

/* ════════════════════════════════════════════
   COMPONENT STYLES
════════════════════════════════════════════ */

const cs = StyleSheet.create({
  card:       { borderWidth: 0.5, borderRadius: 18, padding: 14, marginHorizontal: 14 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                marginBottom: 10, paddingHorizontal: 0 },
  cardTitle:  { fontSize: 10, letterSpacing: 1.3, fontWeight: "600" },
  cardAction: { fontSize: 11, fontWeight: "500" },
  alertRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  alertIcon:  { width: 34, height: 34, borderRadius: 10, borderWidth: 0.5,
                alignItems: "center", justifyContent: "center", flexShrink: 0 },
  alertBtn:   { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 0.5 },
  pill:       { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, borderWidth: 0.5 },
  pillTxt:    { fontSize: 11, fontWeight: "500" },
  bnav:       { flexDirection: "row", justifyContent: "space-around",
                paddingTop: 10, borderTopWidth: 0.5 },
  navItem:    { alignItems: "center", gap: 3, paddingHorizontal: 4 },
  navLabel:   { fontSize: 9.5 },
  navPip:     { width: 4, height: 4, borderRadius: 2 },
});
