// ============================================================
// SafeSwitch · Edge Function: enrollment
// supabase/functions/enrollment/index.ts
//
// Routes (all new — companion to existing enroll/index.ts):
//   POST /enrollment/create-enrollment-draft   → create draft, return default schedules
//   POST /enrollment/save-enrollment-policy    → persist edited schedules to draft
//   POST /enrollment/create-enrollment-qr      → commit child+deal, generate opaque QR token
//   GET  /enrollment/get-enrollment-status     → poll enrollment status
//   POST /enrollment/cancel-enrollment         → cancel and clean up
//
// Design rules enforced here:
//   - No child record is created until create-enrollment-qr (commit point)
//   - QR token is opaque — maps server-side only
//   - Status polling is the sole source of truth for the client
//   - Expired enrollments are rejected at every step
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

function makeUser(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    }
  );
}

function calcAge(dob: string): number {
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

function cryptoToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Default schedule shape — matches enrollmentTypes.ts Schedule
function defaultSchedules(age: number) {
  const bedTime = age < 10 ? "20:00" : age < 13 ? "21:00" : age < 16 ? "22:00" : "22:30";
  return [
    {
      id: "school",
      mode: "school",
      label: "School",
      days: [1, 2, 3, 4, 5],
      start: "08:00",
      end: "15:00",
      screenTimeMinutes: 0,
    },
    {
      id: "homework",
      mode: "homework",
      label: "Homework",
      days: [1, 2, 3, 4, 5],
      start: "16:00",
      end: "18:00",
      screenTimeMinutes: 30,
    },
    {
      id: "bedtime",
      mode: "bedtime",
      label: "Bedtime",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: bedTime,
      end: "07:00",
      screenTimeMinutes: 0,
    },
    {
      id: "free",
      mode: "free",
      label: "Free Time",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: "15:00",
      end: bedTime,
      screenTimeMinutes: 120,
    },
  ];
}

// ============================================================
// POST /enrollment/create-enrollment-draft
//
// Creates an enrollment record (no child written yet).
// Returns default schedules so the parent can review/edit them.
//
// Body: {
//   family_id: string,
//   child: {
//     displayName: string,
//     dateOfBirth: string,  // YYYY-MM-DD
//     avatarColor: string
//   }
// }
//
// Response: EnrollmentDraftResponse
// {
//   enrollment_id: string,
//   child_id: null,           ← not created yet
//   deal: {
//     dealId: string,         ← enrollment_id used as stable ref
//     requiresAgreement: bool,
//     headline: string,
//     schedules: Schedule[]
//   }
// }
// ============================================================
async function handleCreateDraft(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body?.family_id)              return err("family_id required", "MISSING_FIELD");
  if (!body?.child?.displayName)     return err("child.displayName required", "MISSING_FIELD");
  if (!body?.child?.dateOfBirth)     return err("child.dateOfBirth required", "MISSING_FIELD");
  if (!body?.child?.avatarColor)     return err("child.avatarColor required", "MISSING_FIELD");

  // Validate date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.child.dateOfBirth)) {
    return err("child.dateOfBirth must be YYYY-MM-DD", "INVALID_DATE");
  }

  // Authenticate parent
  const userSb = makeUser(req);
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  const sb = makeSvc();

  // Verify parent owns this family
  const { data: family } = await sb
    .from("families")
    .select("id, owner_id")
    .eq("id", body.family_id)
    .single();

  if (!family) return err("Family not found", "NOT_FOUND", 404);
  if (family.owner_id !== user.id) return err("Not authorized for this family", "FORBIDDEN", 403);

  const age = calcAge(body.child.dateOfBirth);
  if (age < 3 || age > 18) return err("Child age must be 3–18", "INVALID_AGE");

  const requiresAgreement = age >= 13;

  // Create enrollment draft — no child record written yet
  const { data: enrollment, error: enrollErr } = await sb
    .from("enrollments")
    .insert({
      family_id:          body.family_id,
      created_by:         user.id,
      child_display_name: body.child.displayName,
      child_date_of_birth: body.child.dateOfBirth,
      child_avatar_color: body.child.avatarColor,
      status:             "draft",
      expires_at:         new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (enrollErr) {
    console.error("create enrollment draft:", enrollErr);
    return err("Failed to create enrollment draft", "INTERNAL_ERROR", 500);
  }

  // Write default schedules to enrollment_schedules
  const schedules = defaultSchedules(age);
  const { error: schedErr } = await sb
    .from("enrollment_schedules")
    .insert(
      schedules.map(s => ({
        enrollment_id:       enrollment.id,
        mode:                s.mode === "homework" ? "study" : s.mode, // map to db enum
        days:                s.days,
        start_time:          s.start,
        end_time:            s.end,
        screen_time_minutes: s.screenTimeMinutes,
      }))
    );

  if (schedErr) {
    console.error("insert enrollment schedules:", schedErr);
    // Non-fatal — schedules can be re-saved via save-enrollment-policy
  }

  return json({
    enrollment_id: enrollment.id,
    child_id: null,  // not created yet — this is intentional
    deal: {
      dealId:             enrollment.id,  // stable client reference
      requiresAgreement,
      headline:           `${body.child.displayName}'s agreement`,
      schedules,
    },
  }, 201);
}

// ============================================================
// POST /enrollment/save-enrollment-policy
//
// Persists the parent's edited schedules to the enrollment draft.
// Safe to call multiple times (upserts).
//
// Body: {
//   enrollment_id: string,
//   schedules: Schedule[]
// }
//
// Response: { ok: true }
// ============================================================
async function handleSavePolicy(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.enrollment_id)          return err("enrollment_id required", "MISSING_FIELD");
  if (!Array.isArray(body?.schedules)) return err("schedules must be an array", "MISSING_FIELD");

  const userSb = makeUser(req);
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  const sb = makeSvc();

  // Verify enrollment exists, belongs to this parent, is not expired
  const { data: enrollment } = await sb
    .from("enrollments")
    .select("id, family_id, status, expires_at")
    .eq("id", body.enrollment_id)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (new Date(enrollment.expires_at) < new Date()) return err("Enrollment has expired", "EXPIRED", 410);
  if (!["draft", "pending_device"].includes(enrollment.status)) {
    return err(`Cannot edit policy in status: ${enrollment.status}`, "INVALID_STATUS", 409);
  }

  // Verify parent owns this enrollment's family
  const { data: family } = await sb
    .from("families")
    .select("owner_id")
    .eq("id", enrollment.family_id)
    .single();

  if (!family || family.owner_id !== user.id) return err("Not authorized", "FORBIDDEN", 403);

  // Upsert all schedules
  const dbEnum: Record<string, string> = { homework: "study" };
  const rows = body.schedules.map((s: any) => ({
    enrollment_id:       body.enrollment_id,
    mode:                dbEnum[s.mode] ?? s.mode,
    days:                s.days,
    start_time:          s.start,
    end_time:            s.end,
    screen_time_minutes: s.screenTimeMinutes ?? null,
  }));

  const { error: upsertErr } = await sb
    .from("enrollment_schedules")
    .upsert(rows, { onConflict: "enrollment_id,mode" });

  if (upsertErr) {
    console.error("save enrollment policy:", upsertErr);
    return err("Failed to save schedules", "INTERNAL_ERROR", 500);
  }

  return json({ ok: true });
}

// ============================================================
// POST /enrollment/create-enrollment-qr
//
// Commit point: creates child + deal records, then generates
// the opaque QR token. Only called when parent taps confirm.
//
// Body: { enrollment_id: string }
//
// Response: EnrollmentQrResponse
// { token: string, expires_at: string }
// ============================================================
async function handleCreateQr(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.enrollment_id) return err("enrollment_id required", "MISSING_FIELD");

  const userSb = makeUser(req);
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  const sb = makeSvc();

  // Load enrollment with schedules
  const { data: enrollment } = await sb
    .from("enrollments")
    .select(`
      id, family_id, created_by, status, expires_at,
      child_display_name, child_date_of_birth, child_avatar_color,
      child_id,
      enrollment_schedules ( mode, days, start_time, end_time, screen_time_minutes )
    `)
    .eq("id", body.enrollment_id)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (new Date(enrollment.expires_at) < new Date()) return err("Enrollment has expired", "EXPIRED", 410);
  if (enrollment.created_by !== user.id) return err("Not authorized", "FORBIDDEN", 403);

  // Only valid in draft or pending_device (regenerate case)
  if (!["draft", "pending_device"].includes(enrollment.status)) {
    return err(`Cannot generate QR in status: ${enrollment.status}`, "INVALID_STATUS", 409);
  }

  const age = calcAge(enrollment.child_date_of_birth);

  let childId = enrollment.child_id;

  // ── Commit child + deal (idempotent — skip if already done) ──
  if (!childId) {
    // Create child record
    const { data: child, error: childErr } = await sb
      .from("children")
      .insert({
        family_id:    enrollment.family_id,
        display_name: enrollment.child_display_name,
        date_of_birth: enrollment.child_date_of_birth,
        avatar_color: enrollment.child_avatar_color,
        created_by:   user.id,
      })
      .select("id")
      .single();

    if (childErr) {
      console.error("create child:", childErr);
      return err("Failed to create child profile", "INTERNAL_ERROR", 500);
    }

    childId = child.id;

    // Generate deal using existing RPC
    const { error: dealErr } = await sb.rpc("generate_default_deal", {
      p_child_id:   childId,
      p_family_id:  enrollment.family_id,
      p_created_by: user.id,
      p_age:        age,
    });

    if (dealErr) {
      console.error("generate_default_deal:", dealErr);
      // Roll back child if deal creation fails
      await sb.from("children").delete().eq("id", childId);
      return err("Failed to generate deal", "INTERNAL_ERROR", 500);
    }

    // Apply the parent's edited schedules over the defaults
    if (enrollment.enrollment_schedules?.length) {
      const dbEnum: Record<string, string> = { homework: "study" };
      for (const s of enrollment.enrollment_schedules) {
        const mode = dbEnum[s.mode] ?? s.mode;
        await sb
          .from("child_schedules")
          .update({
            days:                s.days,
            start_time:          s.start_time,
            end_time:            s.end_time,
            screen_time_minutes: s.screen_time_minutes,
          })
          .eq("child_id", childId)
          .eq("mode", mode);
      }
    }

    // Link child to enrollment
    await sb
      .from("enrollments")
      .update({ child_id: childId, committed_at: new Date().toISOString() })
      .eq("id", enrollment.id);
  }

  // ── Generate opaque QR token ──
  const token      = cryptoToken(24);
  const expiresAt  = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

  const { error: tokenErr } = await sb
    .from("enrollments")
    .update({
      qr_token:            token,
      qr_token_expires_at: expiresAt,
      status:              "pending_device",
    })
    .eq("id", enrollment.id);

  if (tokenErr) {
    console.error("save qr token:", tokenErr);
    return err("Failed to generate QR token", "INTERNAL_ERROR", 500);
  }

  return json({ token, expires_at: expiresAt });
}

// ============================================================
// GET /enrollment/get-enrollment-status?enrollment_id=xxx
//
// Polls the current status of an enrollment.
// Called by the parent app every 2.5s while awaiting agreement.
//
// Response: { status: EnrollmentStatus }
// ============================================================
async function handleGetStatus(req: Request) {
  const url = new URL(req.url);
  const enrollmentId = url.searchParams.get("enrollment_id");
  if (!enrollmentId) return err("enrollment_id required", "MISSING_FIELD");

  const userSb = makeUser(req);
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  const sb = makeSvc();

  const { data: enrollment } = await sb
    .from("enrollments")
    .select("id, status, expires_at, created_by, family_id")
    .eq("id", enrollmentId)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (enrollment.created_by !== user.id) return err("Not authorized", "FORBIDDEN", 403);

  // Auto-expire if TTL passed
  if (
    ["pending_device", "device_detected", "pending_agreement"].includes(enrollment.status) &&
    new Date(enrollment.expires_at) < new Date()
  ) {
    await sb
      .from("enrollments")
      .update({ status: "expired" })
      .eq("id", enrollmentId);
    return json({ status: "expired" });
  }

  return json({ status: enrollment.status });
}

// ============================================================
// POST /enrollment/cancel-enrollment
//
// Parent cancels an in-progress enrollment.
// If child was already committed, child record is NOT deleted
// (parent can re-enroll by generating a new QR).
// Enrollment record is marked cancelled.
//
// Body: { enrollment_id: string }
//
// Response: { ok: true }
// ============================================================
async function handleCancel(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.enrollment_id) return err("enrollment_id required", "MISSING_FIELD");

  const userSb = makeUser(req);
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user) return err("Not authenticated", "UNAUTHORIZED", 401);

  const sb = makeSvc();

  const { data: enrollment } = await sb
    .from("enrollments")
    .select("id, created_by, status, child_id")
    .eq("id", body.enrollment_id)
    .single();

  if (!enrollment) return err("Enrollment not found", "NOT_FOUND", 404);
  if (enrollment.created_by !== user.id) return err("Not authorized", "FORBIDDEN", 403);

  if (["approved", "rejected", "cancelled"].includes(enrollment.status)) {
    // Already terminal — idempotent
    return json({ ok: true });
  }

  await sb
    .from("enrollments")
    .update({
      status:    "cancelled",
      qr_token:  null,           // invalidate QR
    })
    .eq("id", body.enrollment_id);

  // If child was committed but device never connected,
  // mark the deal as superseded so it doesn't block re-enrollment
  if (enrollment.child_id) {
    await sb
      .from("child_deals")
      .update({ status: "superseded" })
      .eq("child_id", enrollment.child_id)
      .eq("status", "sent");
  }

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
  const path = url.pathname.replace(/^\/enrollment/, "");

  try {
    if (req.method === "POST") {
      if (path === "/create-enrollment-draft") return await handleCreateDraft(req);
      if (path === "/save-enrollment-policy")  return await handleSavePolicy(req);
      if (path === "/create-enrollment-qr")    return await handleCreateQr(req);
      if (path === "/cancel-enrollment")       return await handleCancel(req);
    }

    if (req.method === "GET") {
      if (path === "/get-enrollment-status") return await handleGetStatus(req);
    }

    return err("Not found", "NOT_FOUND", 404);

  } catch (e: any) {
    console.error("Unhandled error:", e);
    return err(e?.message ?? "Internal server error", "INTERNAL_ERROR", 500);
  }
});
