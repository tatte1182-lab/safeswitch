// ============================================================
// SafeSwitch · Edge Function: enrollment-redeem
// supabase/functions/enrollment-redeem/index.ts
//
// Called by the CHILD APP when it scans a QR code.
// This is the server-side half of the token — resolves
// the opaque token into enrollment context and advances status.
//
// Routes:
//   POST /enrollment-redeem/redeem   → child scans QR, gets enrollment context
//   POST /enrollment-redeem/accept   → child accepts the deal
//   POST /enrollment-redeem/reject   → child rejects the deal
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, code: string, status = 400) {
  return json({ error: { code, message } }, status);
}

function makeSvc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

function calcAge(dob: string): number {
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

// ============================================================
// POST /enrollment-redeem/redeem
//
// Child app scans QR, sends token. Server resolves it and
// returns the enrollment context (child info + deal schedules).
// Does NOT require child authentication — the token IS the credential.
//
// Body: { token: string, wireguard_public_key: string, platform: string }
//
// Response: {
//   enrollment_id: string,
//   child_id: string,
//   child_name: string,
//   requires_agreement: bool,
//   deal: { schedules, headline, ... }
// }
// ============================================================
async function handleRedeem(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.token)                return err("token required", "MISSING_TOKEN");
  if (!body?.wireguard_public_key) return err("wireguard_public_key required", "MISSING_FIELD");
  if (!body?.platform)             return err("platform required", "MISSING_FIELD");

  if (!/^[A-Za-z0-9+/]{43}=$/.test(body.wireguard_public_key)) {
    return err("Invalid WireGuard public key format", "INVALID_WG_KEY");
  }

  const sb = makeSvc();

  // Look up enrollment by token
  const { data: enrollment } = await sb
    .from("enrollments")
    .select(`
      id, status, family_id, child_id,
      child_display_name, child_date_of_birth, child_avatar_color,
      qr_token_expires_at, expires_at
    `)
    .eq("qr_token", body.token)
    .single();

  if (!enrollment) return err("Invalid or expired token", "INVALID_TOKEN", 401);

  // Check QR token expiry
  if (new Date(enrollment.qr_token_expires_at) < new Date()) {
    return err("QR code has expired — ask parent to generate a new one", "TOKEN_EXPIRED", 410);
  }

  // Check overall enrollment expiry
  if (new Date(enrollment.expires_at) < new Date()) {
    return err("Enrollment has expired", "EXPIRED", 410);
  }

  // Idempotent: if already approved, just return success context
  if (enrollment.status === "approved") {
    return json({ already_enrolled: true, child_id: enrollment.child_id });
  }

  if (!["pending_device", "device_detected"].includes(enrollment.status)) {
    return err(`Cannot redeem in status: ${enrollment.status}`, "INVALID_STATUS", 409);
  }

  const age = calcAge(enrollment.child_date_of_birth);
  const requiresAgreement = age >= 13;

  // Fetch the child's deal and schedules
  const { data: deal } = await sb
    .from("child_deals")
    .select(`
      id, status, requires_child_agreement,
      daily_screen_time_minutes,
      child_schedules ( mode, days, start_time, end_time, screen_time_minutes )
    `)
    .eq("child_id", enrollment.child_id)
    .in("status", ["sent", "accepted"])
    .order("version", { ascending: false })
    .limit(1)
    .single();

  // Advance status
  const newStatus = requiresAgreement ? "pending_agreement" : "approved";

  await sb
    .from("enrollments")
    .update({ status: newStatus })
    .eq("id", enrollment.id);

  // If no agreement required → auto-complete enrollment now
  if (!requiresAgreement && deal?.status !== "accepted") {
    await sb
      .from("child_deals")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("child_id", enrollment.child_id)
      .eq("status", "sent");

    await sb
      .from("enrollments")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", enrollment.id);
  }

  // Format schedules for child app
  const enumMap: Record<string, string> = { study: "homework" };
  const schedules = (deal?.child_schedules ?? []).map((s: any) => ({
    id:                 s.mode,
    mode:               enumMap[s.mode] ?? s.mode,
    label:              s.mode.charAt(0).toUpperCase() + s.mode.slice(1),
    days:               s.days,
    start:              s.start_time,
    end:                s.end_time,
    screenTimeMinutes:  s.screen_time_minutes,
  }));

  return json({
    enrollment_id:      enrollment.id,
    child_id:           enrollment.child_id,
    child_name:         enrollment.child_display_name,
    requires_agreement: requiresAgreement,
    deal: {
      dealId:             deal?.id ?? null,
      requiresAgreement,
      headline:           `${enrollment.child_display_name}'s agreement`,
      schedules,
    },
  });
}

// ============================================================
// POST /enrollment-redeem/accept
//
// Child accepts the deal. Marks enrollment approved.
//
// Body: { enrollment_id: string, deal_id: string }
// Response: { ok: true }
// ============================================================
async function handleAccept(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.enrollment_id) return err("enrollment_id required", "MISSING_FIELD");
  if (!body?.deal_id)       return err("deal_id required", "MISSING_FIELD");

  const sb = makeSvc();

  const { data: enrollment } = await sb
    .from("enrollments")
    .select("id, status, child_id")
    .eq("id", body.enrollment_id)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (enrollment.status !== "pending_agreement") {
    return err(`Cannot accept in status: ${enrollment.status}`, "INVALID_STATUS", 409);
  }

  // Accept the deal
  await sb
    .from("child_deals")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by_child: true })
    .eq("id", body.deal_id)
    .eq("child_id", enrollment.child_id);

  // Mark enrollment complete
  await sb
    .from("enrollments")
    .update({ status: "approved", completed_at: new Date().toISOString() })
    .eq("id", body.enrollment_id);

  // ── Create the device record so it appears on the dashboard ──
  // Pull the enrollment to get child_id + device fingerprint
  const { data: enr } = await sb
    .from("enrollments")
    .select("child_id, device_platform, device_fingerprint, family_id")
    .eq("id", body.enrollment_id)
    .single();

  if (enr?.child_id) {
    // Upsert so re-accepting an enrollment doesn't duplicate
    await sb.from("devices").upsert({
      child_id:           enr.child_id,
      family_id:          enr.family_id,
      platform:           enr.device_platform ?? "android",
      device_fingerprint: enr.device_fingerprint ?? body.device_fingerprint ?? null,
      display_name:       body.device_name ?? "Child's Phone",
      trust_state:        "trusted",
      enrolled_at:        new Date().toISOString(),
      last_seen_at:       new Date().toISOString(),
    }, { onConflict: "child_id, device_fingerprint", ignoreDuplicates: false });
  }

  return json({ ok: true });
}

// ============================================================
// POST /enrollment-redeem/reject
//
// Child rejects the deal.
//
// Body: { enrollment_id: string, deal_id: string }
// Response: { ok: true }
// ============================================================
async function handleReject(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.enrollment_id) return err("enrollment_id required", "MISSING_FIELD");

  const sb = makeSvc();

  const { data: enrollment } = await sb
    .from("enrollments")
    .select("id, status")
    .eq("id", body.enrollment_id)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (enrollment.status !== "pending_agreement") {
    return err(`Cannot reject in status: ${enrollment.status}`, "INVALID_STATUS", 409);
  }

  await sb
    .from("enrollments")
    .update({ status: "rejected" })
    .eq("id", body.enrollment_id);

  return json({ ok: true });
}

// ============================================================
// Router
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url  = new URL(req.url);
  const path = url.pathname.replace(/^\/enrollment-redeem/, "");

  try {
    if (req.method === "POST") {
      if (path === "/redeem") return await handleRedeem(req);
      if (path === "/accept") return await handleAccept(req);
      if (path === "/reject") return await handleReject(req);
    }

    return err("Not found", "NOT_FOUND", 404);

  } catch (e: any) {
    console.error("Unhandled error:", e);
    return err(e?.message ?? "Internal server error", "INTERNAL_ERROR", 500);
  }
});
