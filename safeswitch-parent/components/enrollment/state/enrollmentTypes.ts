export type EnrollmentStep =
  | "form"
  | "creatingDraft"
  | "review"
  | "savingPolicy"
  | "generatingQr"
  | "qr"
  | "awaitingAgreement"
  | "success"
  | "error";

export type ChildFormData = {
  displayName: string;
  dateOfBirth: string; // YYYY-MM-DD
  avatarColor: string;
};

export type ScheduleMode = "school" | "homework" | "bedtime" | "free";

export type Schedule = {
  id: string;
  mode: ScheduleMode;
  label: string;
  days: number[]; // 0=Sun ... 6=Sat
  start: string;  // HH:mm
  end: string;    // HH:mm
  screenTimeMinutes: number | null;
};

export type DealData = {
  dealId: string;
  requiresAgreement: boolean;
  headline: string;
  schedules: Schedule[];
};

export type EnrollmentDraftResponse = {
  enrollment_id: string;
  child_id: string;
  deal: DealData;
};

export type SaveEnrollmentPolicyRequest = {
  schedules: Schedule[];
};

export type EnrollmentQrResponse = {
  token: string;
  expires_at: string; // ISO timestamp
};

export type EnrollmentStatus =
  | "pending_device"
  | "device_detected"
  | "pending_agreement"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type EnrollmentState = {
  step: EnrollmentStep;
  childForm: ChildFormData | null;
  enrollmentId: string | null;
  childId: string | null;
  deal: DealData | null;
  schedules: Schedule[];
  qrToken: string | null;
  qrExpiresAt: string | null;
  status: EnrollmentStatus | null;
  error: string | null;
};

export type EnrollmentAction =
  | { type: "FORM_SUBMIT_STARTED"; payload: ChildFormData }
  | { type: "DRAFT_CREATED"; payload: EnrollmentDraftResponse }
  | { type: "BACK_TO_FORM" }
  | { type: "SCHEDULES_UPDATED"; payload: Schedule[] }
  | { type: "SAVE_POLICY_STARTED" }
  | { type: "QR_GENERATION_STARTED" }
  | { type: "QR_CREATED"; payload: EnrollmentQrResponse }
  | { type: "DEVICE_DETECTED" }
  | { type: "WAITING_FOR_AGREEMENT" }
  | { type: "STATUS_UPDATED"; payload: EnrollmentStatus }
  | { type: "PAIRING_COMPLETED" }
  | { type: "FLOW_ERROR"; payload: string }
  | { type: "RESET" };
