// SafeSwitch · Edge Function · policy-engine
// 3b1.5 — Production-grade Policy Decision Engine
//
// Invoke routes:
//   POST /policy-engine/compute          { device_id, trigger_source? }
//   POST /policy-engine/compute-child    { child_id, trigger_source? }
//   POST /policy-engine/compute-family   { family_id, trigger_source? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.177.0/node/crypto.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/policy-engine/, "");

  try {
    const body = await req.json();
    const trigger: ComputeTrigger = body.trigger_source ?? "manual_recompute";

    if (path === "/compute" && body.device_id) {
      const result = await computeForDevice(body.device_id, trigger);
      return json({ ok: true, device_id: body.device_id, state: result });
    }

    if (path === "/compute-child" && body.child_id) {
      const devices = await getDevicesForChild(body.child_id);
      const results = await Promise.allSettled(
        devices.map(d => computeForDevice(d.id, trigger))
      );
      return json({ ok: true, child_id: body.child_id, ...summariseSettled(results) });
    }

    if (path === "/compute-family" && body.family_id) {
      const devices = await getDevicesForFamily(body.family_id);
      const results = await Promise.allSettled(
        devices.map(d => computeForDevice(d.id, trigger))
      );
      return json({ ok: true, family_id: body.family_id, ...summariseSettled(results) });
    }

    return json({ error: "Unknown route or missing parameter" }, 400);

  } catch (err: any) {
    console.error("[policy-engine] error:", err);
    return json({ error: err.message ?? "Internal error" }, 500);
  }
});

// ── Core computation ─────────────────────────────────────────

async function computeForDevice(
  deviceId: string,
  trigger: ComputeTrigger
): Promise<EffectiveState> {
  const device = await getDevice(deviceId);
  if (!device) throw new Error(`Device not found: ${deviceId}`);

  const policy = await getPolicyForChild(device.child_id);
  if (!policy) {
    return writeState(deviceId, device.child_id, device.family_id,
      unrestricted(), trigger
    );
  }

  // Evaluate time in the family's timezone
  const now = nowInTimezone(policy.timezone);

  // ── Priority ladder ──────────────────────────────────────

  // 1. Emergency lock — nothing overrides this
  if (policy.emergency_lock) {
    return writeState(deviceId, device.child_id, device.family_id, {
      ...unrestricted(),
      internet_paused: true,
      emergency_locked: true,
      state_reason: "emergency_lock",
      resolved_route_mode: "full_tunnel",
      banner_title: "Device locked",
      banner_body: "A parent has locked this device.",
      banner_source: "emergency",
      banner_until: null,
      next_state_change_at: null,
    }, trigger);
  }

  // 2. Active approved override — check scope before applying
  const activeOverride = await getActiveOverride(policy.id, deviceId, now);
  if (activeOverride) {
    const base = await resolveBaseState(policy, device, now, activeOverride);
    return writeState(deviceId, device.child_id, device.family_id, {
      ...base,
      internet_paused: false,
      state_reason: "override_active",
      active_override_id: activeOverride.id,
      next_state_change_at: activeOverride.override_expires_at,
      banner_title: "Access granted",
      banner_body: `Temporary access until ${formatTime(activeOverride.override_expires_at, policy.timezone)}`,
      banner_source: "override",
      banner_until: activeOverride.override_expires_at,
    }, trigger);
  }

  // 3. Manual parent pause
  if (policy.is_paused) {
    const stillPaused = !policy.paused_until || new Date(policy.paused_until) > now;
    if (stillPaused) {
      return writeState(deviceId, device.child_id, device.family_id, {
        ...unrestricted(),
        internet_paused: true,
        state_reason: "parent_pause",
        resolved_route_mode: policy.default_route_mode,
        next_state_change_at: policy.paused_until ?? null,
        banner_title: "Internet paused",
        banner_body: policy.paused_until
          ? `Paused until ${formatTime(policy.paused_until, policy.timezone)}`
          : "Paused by a parent",
        banner_source: "parent_pause",
        banner_until: policy.paused_until ?? null,
      }, trigger);
    }
  }

  // 4. Bedtime
  if (policy.bedtime_enabled && policy.bedtime_start && policy.bedtime_end) {
    if (isDuringBedtime(now, policy.bedtime_start, policy.bedtime_end)) {
      const until = nextBedtimeEnd(now, policy.bedtime_end, policy.timezone);
      return writeState(deviceId, device.child_id, device.family_id, {
        ...unrestricted(),
        internet_paused: true,
        state_reason: "schedule",
        resolved_route_mode: policy.default_route_mode,
        next_state_change_at: until,
        banner_title: "Bedtime",
        banner_body: `Internet is off until ${formatTime(until, policy.timezone)}`,
        banner_source: "bedtime",
        banner_until: until,
      }, trigger);
    }
  }

  // 5. Full schedule + filter + app block resolution
  const base = await resolveBaseState(policy, device, now, null);
  return writeState(deviceId, device.child_id, device.family_id, base, trigger);
}

// ── Base state resolver ──────────────────────────────────────

async function resolveBaseState(
  policy: Policy,
  device: Device,
  now: Date,
  activeOverride: Override | null
): Promise<EffectiveStateWrite> {

  const day = getDayName(now);
  const time = getTimeStr(now);

  // Load schedules sorted by priority asc, created_at desc (deterministic)
  const schedules = await getActiveScheduleRules(policy.id, day, time);

  // Safety rules always win regardless of priority
  const safetyRule = schedules.find(r => r.rule_type === "safety");
  const activeSchedule = safetyRule ?? schedules[0] ?? null;

  // Override scope determines what gets lifted
  const overrideLiftsAll = activeOverride?.override_scope === "lift_all_restrictions";
  const overrideLiftsBedtime = activeOverride?.override_scope === "lift_bedtime";
  const keepSafetyFilters = activeOverride?.keep_safety_filters ?? true;

  const schedulePaused = !overrideLiftsAll && (activeSchedule?.internet_paused ?? false);

  // Route mode: schedule override → policy default
  const resolvedRouteMode: RouteMode =
    activeSchedule?.route_mode_override ??
    policy.default_route_mode ??
    "full_tunnel";

  // Filter profile: schedule override → policy default
  const filterProfileId =
    activeSchedule?.web_filter_profile_id ??
    policy.web_filter_profile_id ??
    null;

  const filterProfile = filterProfileId
    ? await getFilterProfile(filterProfileId)
    : null;

  // App blocks — skip if override lifts all (but keep safety filters if flagged)
  const appBlocks = overrideLiftsAll && !keepSafetyFilters
    ? []
    : await getActiveAppBlockRules(policy.id, day, time);

  // Specific app override — only block rules NOT matching the allowed app
  const activeAppBlocks = activeOverride?.override_scope === "allow_specific_app" && activeOverride.override_app_id
    ? appBlocks.filter(a => a.id !== activeOverride.override_app_id)
    : appBlocks;

  // DNS patterns: filter categories + filter domains + app block patterns
  // Conflict resolution: safety blocks > explicit blocks > category blocks > allowlist exceptions
  const categoryPatterns = filterProfile
    ? categoryToDnsPatterns(filterProfile.blocked_categories, keepSafetyFilters)
    : [];
  const filterDomainPatterns = filterProfile?.blocked_domains ?? [];
  const appDnsPatterns = activeAppBlocks.flatMap(a => a.dns_patterns);
  const activeDnsPatterns = [...new Set([...categoryPatterns, ...filterDomainPatterns, ...appDnsPatterns])];

  // Allowlist — never override safety category blocks
  const allowedDomains = filterProfile?.allowed_domains ?? [];
  const safetyDomains = categoryToDnsPatterns(["malware","phishing"], true);
  const activeAllowedDomains = allowedDomains.filter(
    d => !safetyDomains.some(s => domainMatchesPattern(d, s))
  );

  // IP ranges from app blocks
  const activeIpRanges = [...new Set(activeAppBlocks.flatMap(a => a.ip_ranges))];

  // Determine next state change — full lookahead across all boundaries
  const nextChange = computeNextChange(now, policy, activeSchedule, activeOverride);

  // Banner
  const isAgreementRule = activeSchedule?.is_agreement_rule ?? false;
  const stateReason: StateReason = schedulePaused
    ? (isAgreementRule ? "agreement_rule" : "schedule")
    : activeDnsPatterns.length > 0 || activeAppBlocks.length > 0
      ? (isAgreementRule ? "agreement_rule" : "schedule")
      : "unrestricted";

  const { bannerTitle, bannerBody, bannerSource } = buildBanner(
    stateReason, activeSchedule, nextChange, policy.timezone
  );

  return {
    internet_paused: schedulePaused,
    emergency_locked: false,
    state_reason: stateReason,
    resolved_route_mode: resolvedRouteMode,
    active_filter_profile_id: filterProfileId,
    active_app_block_ids: activeAppBlocks.map(a => a.id),
    active_dns_patterns: activeDnsPatterns,
    active_allowed_domains: activeAllowedDomains,
    active_ip_ranges: activeIpRanges,
    safe_search_enabled: filterProfile?.safe_search_enabled ?? false,
    youtube_restricted: filterProfile?.youtube_restricted ?? false,
    active_rule_id: activeSchedule?.id ?? null,
    active_override_id: activeOverride?.id ?? null,
    next_state_change_at: nextChange,
    banner_title: bannerTitle,
    banner_body: bannerBody,
    banner_source: bannerSource,
    banner_until: nextChange,
  };
}

// ── Write state with hash + audit ────────────────────────────

async function writeState(
  deviceId: string,
  childId: string,
  familyId: string,
  state: EffectiveStateWrite,
  trigger: ComputeTrigger
): Promise<EffectiveState> {

  // Compute hash of enforcement-relevant fields
  const hashInput = JSON.stringify({
    internet_paused: state.internet_paused,
    emergency_locked: state.emergency_locked,
    resolved_route_mode: state.resolved_route_mode,
    active_dns_patterns: [...state.active_dns_patterns].sort(),
    active_allowed_domains: [...state.active_allowed_domains].sort(),
    active_ip_ranges: [...state.active_ip_ranges].sort(),
    safe_search_enabled: state.safe_search_enabled,
    youtube_restricted: state.youtube_restricted,
    active_app_block_ids: [...state.active_app_block_ids].sort(),
  });
  const newHash = createHash("sha256").update(hashInput).digest("hex");

  // Load current state to check if anything changed
  const { data: current } = await supabase
    .from("child_effective_state")
    .select("state_hash, state_version, state_reason, is_paused")
    .eq("device_id", deviceId)
    .single();

  const unchanged = current?.state_hash === newHash;
  const newVersion = (current?.state_version ?? 0) + (unchanged ? 0 : 1);

  const row = {
    device_id: deviceId,
    child_id: childId,
    family_id: familyId,
    last_computed_at: new Date().toISOString(),
    last_trigger: trigger,
    state_hash: newHash,
    state_version: newVersion,
    ...state,
  };

  const { data, error } = await supabase
    .from("child_effective_state")
    .upsert(row, { onConflict: "device_id" })
    .select()
    .single();

  if (error) throw error;

  // Write audit event only if state actually changed
  if (!unchanged) {
    await supabase.from("child_effective_state_events").insert({
      device_id: deviceId,
      child_id: childId,
      family_id: familyId,
      previous_state_hash: current?.state_hash ?? null,
      new_state_hash: newHash,
      previous_reason: current?.state_reason ?? null,
      new_reason: state.state_reason,
      previous_paused: current?.is_paused ?? null,
      new_paused: state.internet_paused,
      trigger_source: trigger,
      trigger_detail: { active_rule_id: state.active_rule_id, active_override_id: state.active_override_id },
      changed_at: new Date().toISOString(),
    });
  }

  return data;
}

// ── DB helpers ───────────────────────────────────────────────

async function getDevice(deviceId: string): Promise<Device | null> {
  const { data } = await supabase
    .from("devices").select("id, child_id, family_id").eq("id", deviceId).single();
  return data;
}

async function getDevicesForChild(childId: string): Promise<Device[]> {
  const { data } = await supabase
    .from("devices").select("id, child_id, family_id").eq("child_id", childId);
  return data ?? [];
}

async function getDevicesForFamily(familyId: string): Promise<Device[]> {
  const { data } = await supabase
    .from("devices").select("id, child_id, family_id")
    .eq("family_id", familyId).not("child_id", "is", null);
  return data ?? [];
}

async function getPolicyForChild(childId: string): Promise<Policy | null> {
  const { data } = await supabase
    .from("child_policy_profiles").select("*").eq("child_id", childId).single();
  return data;
}

async function getActiveOverride(
  policyId: string, deviceId: string, now: Date
): Promise<Override | null> {
  const { data } = await supabase
    .from("device_override_requests")
    .select("id, override_expires_at, override_scope, override_app_id, keep_safety_filters")
    .eq("policy_id", policyId).eq("device_id", deviceId).eq("status", "approved")
    .gt("override_expires_at", now.toISOString())
    .order("override_expires_at", { ascending: false })
    .limit(1).single();
  return data;
}

async function getActiveScheduleRules(
  policyId: string, day: string, time: string
): Promise<ScheduleRule[]> {
  // Fetch sorted by priority asc, created_at desc — deterministic winner is [0]
  const { data } = await supabase
    .from("child_schedule_rules")
    .select("*")
    .eq("policy_id", policyId).eq("is_active", true)
    .contains("days", [day])
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (!data) return [];
  return data.filter(r => timeInWindow(time, r.start_time, r.end_time));
}

async function getFilterProfile(profileId: string): Promise<FilterProfile | null> {
  const { data } = await supabase
    .from("web_filter_profiles")
    .select("blocked_domains, allowed_domains, blocked_categories, safe_search_enabled, youtube_restricted")
    .eq("id", profileId).single();
  return data;
}

async function getActiveAppBlockRules(
  policyId: string, day: string, time: string
): Promise<AppBlockRule[]> {
  const { data } = await supabase
    .from("app_block_rules")
    .select("id, dns_patterns, ip_ranges, blocked_days, blocked_start, blocked_end, is_agreement_rule")
    .eq("policy_id", policyId).eq("is_active", true);
  if (!data) return [];
  return data.filter(r => {
    if (!r.blocked_days) return true;
    if (!r.blocked_days.includes(day)) return false;
    if (!r.blocked_start || !r.blocked_end) return true;
    return timeInWindow(time, r.blocked_start, r.blocked_end);
  });
}

// ── Time helpers (timezone-aware) ────────────────────────────

function nowInTimezone(tz: string): Date {
  // Deno/V8 Intl is available in Supabase Edge runtime
  try {
    const str = new Date().toLocaleString("en-US", { timeZone: tz });
    return new Date(str);
  } catch {
    return new Date(); // fallback UTC
  }
}

function getDayName(d: Date): string {
  return ["sun","mon","tue","wed","thu","fri","sat"][d.getDay()];
}

function getTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function timeInWindow(time: string, start: string, end: string): boolean {
  if (start <= end) return time >= start && time <= end;
  return time >= start || time <= end; // overnight window
}

function isDuringBedtime(now: Date, start: string, end: string): boolean {
  return timeInWindow(getTimeStr(now), start, end);
}

function nextBedtimeEnd(now: Date, bedtimeEnd: string, tz: string): string {
  const [h, m] = bedtimeEnd.split(":").map(Number);
  const next = new Date(nowInTimezone(tz));
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function computeNextChange(
  now: Date,
  policy: Policy,
  activeSchedule: ScheduleRule | null,
  activeOverride: Override | null
): string | null {
  const candidates: Date[] = [];

  // Override expiry
  if (activeOverride?.override_expires_at) {
    candidates.push(new Date(activeOverride.override_expires_at));
  }

  // Pause expiry
  if (policy.paused_until) {
    candidates.push(new Date(policy.paused_until));
  }

  // Active schedule end
  if (activeSchedule?.end_time) {
    const [h, m] = activeSchedule.end_time.split(":").map(Number);
    const t = new Date(now);
    t.setHours(h, m, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    candidates.push(t);
  }

  // Bedtime start (if not currently in bedtime)
  if (policy.bedtime_enabled && policy.bedtime_start) {
    const [h, m] = policy.bedtime_start.split(":").map(Number);
    const t = new Date(now);
    t.setHours(h, m, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    candidates.push(t);
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0].toISOString();
}

function formatTime(iso: string | null, tz: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: tz, hour: "numeric", minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

// ── Banner builder ───────────────────────────────────────────

function buildBanner(
  reason: StateReason,
  activeSchedule: ScheduleRule | null,
  nextChange: string | null,
  tz: string
): { bannerTitle: string | null; bannerBody: string | null; bannerSource: string | null } {
  if (reason === "unrestricted") {
    return { bannerTitle: null, bannerBody: null, bannerSource: null };
  }
  const untilStr = nextChange ? ` until ${formatTime(nextChange, tz)}` : "";
  if (reason === "agreement_rule") {
    return {
      bannerTitle: activeSchedule?.agreement_label ?? "Agreement rule active",
      bannerBody: `This restriction is part of your agreement${untilStr}.`,
      bannerSource: "agreement",
    };
  }
  if (reason === "schedule") {
    return {
      bannerTitle: activeSchedule?.label ?? "Restrictions active",
      bannerBody: `Some content is restricted${untilStr}.`,
      bannerSource: "schedule",
    };
  }
  return { bannerTitle: null, bannerBody: null, bannerSource: null };
}

// ── DNS category map ─────────────────────────────────────────

function categoryToDnsPatterns(categories: string[], safetyOnly = false): string[] {
  const map: Record<string, string[]> = {
    social_media:  ["*.facebook.com","*.fbcdn.net","*.instagram.com","*.tiktok.com","*.tiktokcdn.com","*.snapchat.com","*.twitter.com","*.x.com","*.twimg.com"],
    gaming:        ["*.roblox.com","*.rbxcdn.com","*.minecraft.net","*.steampowered.com","*.epicgames.com","*.fortnite.com"],
    streaming:     ["*.netflix.com","*.nflxvideo.net","*.youtube.com","*.googlevideo.com","*.twitch.tv","*.disneyplus.com","*.hulu.com"],
    messaging:     ["*.discord.com","*.discordapp.com","*.telegram.org","*.whatsapp.com","*.whatsapp.net"],
    adult_content: ["*.pornhub.com","*.xvideos.com","*.xnxx.com","*.onlyfans.com","*.redtube.com"],
    gambling:      ["*.bet365.com","*.draftkings.com","*.fanduel.com","*.pokerstars.com"],
    shopping:      ["*.wish.com","*.shein.com"],
    malware:       ["*.malware-traffic-analysis.net","*.bazaar.abuse.ch"],
    phishing:      ["*.phishtank.com"],
  };
  const cats = safetyOnly ? ["malware","phishing"] : categories;
  return cats.flatMap(c => map[c] ?? []);
}

function domainMatchesPattern(domain: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    return domain.endsWith(pattern.slice(1));
  }
  return domain === pattern;
}

// ── Helpers ──────────────────────────────────────────────────

function unrestricted(): EffectiveStateWrite {
  return {
    internet_paused: false, emergency_locked: false, state_reason: "unrestricted",
    resolved_route_mode: "full_tunnel", active_filter_profile_id: null,
    active_app_block_ids: [], active_dns_patterns: [], active_allowed_domains: [],
    active_ip_ranges: [], safe_search_enabled: false, youtube_restricted: false,
    active_rule_id: null, active_override_id: null, next_state_change_at: null,
    banner_title: null, banner_body: null, banner_source: null, banner_until: null,
  };
}

function summariseSettled(results: PromiseSettledResult<EffectiveState>[]) {
  return {
    computed: results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
    errors: results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map(r => r.reason?.message ?? "unknown"),
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

// ── Types ────────────────────────────────────────────────────

type ComputeTrigger = "policy_updated"|"schedule_tick"|"override_approved"|"override_expired"|"device_enrolled"|"parent_pause"|"parent_unpause"|"emergency_lock"|"emergency_unlock"|"manual_recompute";
type RouteMode = "full_tunnel"|"split_tunnel"|"service_only";
type StateReason = "schedule"|"parent_pause"|"override_active"|"agreement_rule"|"emergency_lock"|"unrestricted";

interface Device { id: string; child_id: string; family_id: string; }
interface Policy {
  id: string; child_id: string; family_id: string; mode: string;
  timezone: string; is_paused: boolean; paused_until: string | null;
  emergency_lock: boolean; bedtime_enabled: boolean;
  bedtime_start: string | null; bedtime_end: string | null;
  web_filter_profile_id: string | null; default_route_mode: RouteMode;
}
interface Override {
  id: string; override_expires_at: string;
  override_scope: string; override_app_id: string | null;
  keep_safety_filters: boolean;
}
interface ScheduleRule {
  id: string; start_time: string; end_time: string; label: string;
  internet_paused: boolean; web_filter_profile_id: string | null;
  is_agreement_rule: boolean; agreement_label: string | null;
  rule_type: string; priority: number; route_mode_override: RouteMode | null;
}
interface FilterProfile {
  blocked_domains: string[]; allowed_domains: string[];
  blocked_categories: string[]; safe_search_enabled: boolean;
  youtube_restricted: boolean;
}
interface AppBlockRule {
  id: string; dns_patterns: string[]; ip_ranges: string[];
  blocked_days: string[] | null; blocked_start: string | null;
  blocked_end: string | null; is_agreement_rule: boolean;
}
interface EffectiveStateWrite {
  internet_paused: boolean; emergency_locked: boolean; state_reason: string;
  resolved_route_mode: RouteMode; active_filter_profile_id: string | null;
  active_app_block_ids: string[]; active_dns_patterns: string[];
  active_allowed_domains: string[]; active_ip_ranges: string[];
  safe_search_enabled: boolean; youtube_restricted: boolean;
  active_rule_id: string | null; active_override_id: string | null;
  next_state_change_at: string | null;
  banner_title: string | null; banner_body: string | null;
  banner_source: string | null; banner_until: string | null;
}
interface EffectiveState extends EffectiveStateWrite {
  device_id: string; child_id: string; family_id: string;
  last_computed_at: string; state_hash: string; state_version: number;
}
