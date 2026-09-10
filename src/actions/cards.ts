"use server";

import { getSupabase } from "@/lib/supabase/server";

export interface UpgradeResult {
  ok: boolean;
  persisted: boolean;
  newLevel: number | null;
  newMultiplier: number | null;
  newQuantity: number | null;
  newBalance: number | null;
  /** true si el error fue por saldo o duplicados insuficientes. */
  insufficient?: boolean;
  error?: string;
}

/**
 * Mejora una carta del inventario vía el RPC transaccional `upgrade_card`.
 * En modo demo devuelve persisted=false y el frontend simula la mejora.
 */
export async function upgradeCard(cardId: string): Promise<UpgradeResult> {
  const supabase = await getSupabase();
  if (!supabase) {
    return {
      ok: false,
      persisted: false,
      newLevel: null,
      newMultiplier: null,
      newQuantity: null,
      newBalance: null,
    };
  }

  const { data, error } = await supabase.rpc("upgrade_card", {
    p_card_id: cardId,
  });

  if (error) {
    const insufficient = /insuficiente|duplicados/i.test(error.message);
    console.error("[upgradeCard] RPC error:", error.message);
    return {
      ok: false,
      persisted: true,
      newLevel: null,
      newMultiplier: null,
      newQuantity: null,
      newBalance: null,
      insufficient,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    persisted: true,
    newLevel: row?.new_level ?? null,
    newMultiplier: row?.new_multiplier ?? null,
    newQuantity: row?.new_quantity ?? null,
    newBalance: row?.new_balance ?? null,
  };
}
