"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import type { ActivityRow } from "@/lib/activity";

/** Trae los logs (MET/SURPASSED) del usuario desde pFrom (YYYY-MM-DD). Read-only. */
export async function fetchActivity(pFrom: string): Promise<ActivityRow[]> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc("activity_log", { p_from: pFrom });
  if (error) {
    console.error("[fetchActivity] RPC error:", error.message);
    return [];
  }
  return (data ?? []) as ActivityRow[];
}
