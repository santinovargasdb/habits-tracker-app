"use server";

import { getSupabase } from "@/lib/supabase/server";
import type { HabitStatus } from "@/lib/types";

export interface SetStatusResult {
  /** true si se persistió en Supabase (false en modo demo o ante error). */
  persisted: boolean;
  /** Balance autoritativo devuelto por la DB (null si no se persistió). */
  balance: number | null;
  /** Monedas acreditadas por el estado (con multiplicador del mazo aplicado). */
  coinsAwarded: number | null;
  status: HabitStatus;
  error?: string;
}

/**
 * Setea el estado de un hábito para una fecha y ajusta la wallet de forma
 * atómica (RPC `set_habit_status`).  El frontend aplica el cambio de manera
 * OPTIMISTA y luego reconcilia el balance con el valor que devuelve esta acción.
 */
export async function setHabitStatus(
  habitId: string,
  date: string,
  status: HabitStatus,
): Promise<SetStatusResult> {
  const supabase = await getSupabase();

  // Modo demo: no hay backend, el frontend conserva su estado optimista.
  if (!supabase) {
    return { persisted: false, balance: null, coinsAwarded: null, status };
  }

  const { data, error } = await supabase.rpc("set_habit_status", {
    p_habit_id: habitId,
    p_date: date,
    p_status: status,
  });

  if (error) {
    console.error("[setHabitStatus] RPC error:", error.message);
    return {
      persisted: false,
      balance: null,
      coinsAwarded: null,
      status,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const balance = row && typeof row.balance === "number" ? row.balance : null;
  const coinsAwarded =
    row && typeof row.coins_awarded === "number" ? row.coins_awarded : null;

  return { persisted: true, balance, coinsAwarded, status };
}
