import { useEffect, useMemo, useState } from "react";

export function useQrCountdown(expiresAt: string | null) {
  const initial = useMemo(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }, [expiresAt]);

  const [secondsLeft, setSecondsLeft] = useState(initial);

  useEffect(() => { setSecondsLeft(initial); }, [initial]);

  useEffect(() => {
    if (!expiresAt || secondsLeft <= 0) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, secondsLeft]);

  return { secondsLeft, expired: secondsLeft <= 0 };
}
