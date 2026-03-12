import {
  ChildFormData,
  EnrollmentDraftResponse,
  EnrollmentQrResponse,
  EnrollmentStatus,
  SaveEnrollmentPolicyRequest,
} from "../state/enrollmentTypes";

const DEV_MOCK = __DEV__ && process.env.EXPO_PUBLIC_DEV_MOCK === "true";

if (!__DEV__ && DEV_MOCK) {
  throw new Error("DEV_MOCK must never be enabled in production.");
}

function getBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");
  return url;
}

function getHeaders(authToken: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };
}

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text || "Request failed"}`);
  }
  return (await res.json()) as T;
}

function assertDraftResponse(x: any): asserts x is EnrollmentDraftResponse {
  if (!x?.enrollment_id || !x?.child_id || !x?.deal?.dealId)
    throw new Error("Invalid enrollment draft response");
}

function assertQrResponse(x: any): asserts x is EnrollmentQrResponse {
  if (!x?.token || !x?.expires_at)
    throw new Error("Invalid QR response");
}

function assertStatusResponse(x: any): asserts x is { status: EnrollmentStatus } {
  if (!x?.status)
    throw new Error("Invalid enrollment status response");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function createEnrollmentDraft(
  authToken: string,
  familyId: string,
  childForm: ChildFormData,
  signal?: AbortSignal
): Promise<EnrollmentDraftResponse> {
  if (DEV_MOCK) {
    await sleep(800);
    return {
      enrollment_id: "enr_mock_001",
      child_id: "child_mock_001",
      deal: {
        dealId: "deal_mock_001",
        requiresAgreement: true,
        headline: `${childForm.displayName}'s agreement`,
        schedules: [
          { id: "school",   mode: "school",   label: "School",    days: [1,2,3,4,5],       start: "07:30", end: "15:00", screenTimeMinutes: 0   },
          { id: "homework", mode: "homework", label: "Homework",  days: [1,2,3,4,5],       start: "16:00", end: "18:00", screenTimeMinutes: 30  },
          { id: "bedtime",  mode: "bedtime",  label: "Bedtime",   days: [0,1,2,3,4,5,6],  start: "21:00", end: "06:30", screenTimeMinutes: 0   },
          { id: "free",     mode: "free",     label: "Free Time", days: [0,6],             start: "10:00", end: "18:00", screenTimeMinutes: 120 },
        ],
      },
    };
  }

  const res = await fetch(`${getBaseUrl()}/functions/v1/enrollment/create-enrollment-draft`, {
    method: "POST",
    headers: getHeaders(authToken),
    body: JSON.stringify({ family_id: familyId, child: childForm }),
    signal,
  });
  const json = await expectJson<EnrollmentDraftResponse>(res);
  assertDraftResponse(json);
  return json;
}

export async function saveEnrollmentPolicy(
  authToken: string,
  enrollmentId: string,
  request: SaveEnrollmentPolicyRequest,
  signal?: AbortSignal
): Promise<void> {
  if (DEV_MOCK) { await sleep(1800); return; }

  const res = await fetch(`${getBaseUrl()}/functions/v1/enrollment/save-enrollment-policy`, {
    method: "POST",
    headers: getHeaders(authToken),
    body: JSON.stringify({ enrollment_id: enrollmentId, schedules: request.schedules }),
    signal,
  });
  if (!res.ok) throw new Error(`Policy save failed: ${await res.text() || res.status}`);
}

export async function createEnrollmentQr(
  authToken: string,
  enrollmentId: string,
  signal?: AbortSignal
): Promise<EnrollmentQrResponse> {
  if (DEV_MOCK) {
    await sleep(1800);
    return {
      token: "qr_mock_token_123",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  const res = await fetch(`${getBaseUrl()}/functions/v1/enrollment/create-enrollment-qr`, {
    method: "POST",
    headers: getHeaders(authToken),
    body: JSON.stringify({ enrollment_id: enrollmentId }),
    signal,
  });
  const json = await expectJson<EnrollmentQrResponse>(res);
  assertQrResponse(json);
  return json;
}

// DEV_MOCK: simulate child accepting after ~5 seconds
const _mockStatusStart: Record<string, number> = {};

export async function getEnrollmentStatus(
  authToken: string,
  enrollmentId: string,
  signal?: AbortSignal
): Promise<EnrollmentStatus> {
  if (DEV_MOCK) {
    await sleep(300);
    if (!_mockStatusStart[enrollmentId]) {
      _mockStatusStart[enrollmentId] = Date.now();
    }
    const elapsed = Date.now() - _mockStatusStart[enrollmentId];
    return elapsed > 5000 ? "approved" : "pending_agreement";
  }

  const res = await fetch(
    `${getBaseUrl()}/functions/v1/enrollment/get-enrollment-status?enrollment_id=${encodeURIComponent(enrollmentId)}`,
    { method: "GET", headers: getHeaders(authToken), signal }
  );
  const json = await expectJson<{ status: EnrollmentStatus }>(res);
  assertStatusResponse(json);
  return json.status;
}

export async function cancelEnrollment(
  authToken: string,
  enrollmentId: string,
  signal?: AbortSignal
): Promise<void> {
  if (DEV_MOCK) return;

  const res = await fetch(`${getBaseUrl()}/functions/v1/enrollment/cancel-enrollment`, {
    method: "POST",
    headers: getHeaders(authToken),
    body: JSON.stringify({ enrollment_id: enrollmentId }),
    signal,
  });
  if (!res.ok) throw new Error(`Cancel failed: ${await res.text() || res.status}`);
}
