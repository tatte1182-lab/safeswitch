/* ─────────────────────────────────────────────────────────────
   SafeSwitch — Supabase client singleton
   Import this everywhere — never instantiate createClient twice.
───────────────────────────────────────────────────────────── */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL  ?? "";
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON in .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 10 } },
});