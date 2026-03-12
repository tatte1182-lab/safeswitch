import { EnrollmentAction, EnrollmentState } from "./enrollmentTypes";

export const initialEnrollmentState: EnrollmentState = {
  step: "form",
  childForm: null,
  enrollmentId: null,
  childId: null,
  deal: null,
  schedules: [],
  qrToken: null,
  qrExpiresAt: null,
  status: null,
  error: null,
};

export function enrollmentReducer(
  state: EnrollmentState,
  action: EnrollmentAction
): EnrollmentState {
  switch (action.type) {
    case "FORM_SUBMIT_STARTED":
      return { ...state, childForm: action.payload, step: "creatingDraft", error: null };

    case "DRAFT_CREATED":
      return {
        ...state,
        enrollmentId: action.payload.enrollment_id,
        childId: action.payload.child_id,
        deal: action.payload.deal,
        schedules: action.payload.deal.schedules,
        step: "review",
        error: null,
      };

    case "BACK_TO_FORM":
      return { ...state, step: "form", error: null };

    case "SCHEDULES_UPDATED":
      return { ...state, schedules: action.payload };

    case "SAVE_POLICY_STARTED":
      return { ...state, step: "savingPolicy", error: null };

    case "QR_GENERATION_STARTED":
      return { ...state, step: "generatingQr", error: null };

    case "QR_CREATED":
      return {
        ...state,
        qrToken: action.payload.token,
        qrExpiresAt: action.payload.expires_at,
        status: "pending_device",
        step: "qr",
        error: null,
      };

    case "DEVICE_DETECTED":
      return { ...state, status: "device_detected" };

    case "WAITING_FOR_AGREEMENT":
      return { ...state, step: "awaitingAgreement", status: "pending_agreement" };

    case "STATUS_UPDATED": {
      const s = action.payload;
      if (s === "approved")  return { ...state, status: s, step: "success", error: null };
      if (s === "rejected")  return { ...state, status: s, step: "error", error: "Agreement was declined." };
      if (s === "expired")   return { ...state, status: s, step: "error", error: "Enrollment expired." };
      if (s === "cancelled") return { ...state, status: s, step: "error", error: "Enrollment was cancelled." };
      return { ...state, status: s };
    }

    case "PAIRING_COMPLETED":
      return { ...state, status: "approved", step: "success", error: null };

    case "FLOW_ERROR":
      return { ...state, step: "error", error: action.payload };

    case "RESET":
      return initialEnrollmentState;

    default:
      return state;
  }
}
