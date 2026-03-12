import { useEffect, useRef } from "react";
import { getEnrollmentStatus } from "../services/enrollmentApi";
import { EnrollmentStatus } from "../state/enrollmentTypes";

type Params = {
  enabled: boolean;
  authToken: string;
  enrollmentId: string | null;
  onStatus: (status: EnrollmentStatus) => void;
  pollMs?: number;
};

export function useEnrollmentStatus({ enabled, authToken, enrollmentId, onStatus, pollMs = 2500 }: Params) {
  const lastStatus = useRef<EnrollmentStatus | null>("pending_agreement");

  useEffect(() => {
    if (!enabled || !enrollmentId) return;
    let stopped = false;
    const controller = new AbortController();

    async function tick() {
      try {
        const status = await getEnrollmentStatus(authToken, enrollmentId!, controller.signal);
        if (!stopped && status !== lastStatus.current) {
          lastStatus.current = status;
          onStatus(status);
        }
      } catch { /* keep polling quietly */ }
    }

    // Delay first tick slightly so the screen animation settles before any dispatch
    const initialDelay = setTimeout(() => {
      tick();
      const id = setInterval(tick, pollMs);
      return () => { stopped = true; controller.abort(); clearInterval(id); };
    }, 600);

    return () => { stopped = true; controller.abort(); clearTimeout(initialDelay); };
  }, [enabled, authToken, enrollmentId, onStatus, pollMs]);
}
