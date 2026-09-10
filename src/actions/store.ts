"use server";

import { getSupabase } from "@/lib/supabase/server";
import type { ChestType } from "@/lib/types";

export interface PurchaseResult {
  /** true si la compra se concretó en la DB. */
  ok: boolean;
  persisted: boolean;
  wonCardId: string | null;
  newBalance: number | null;
  newQuantity: number | null;
  isNew: boolean;
  /** true si el error fue por saldo insuficiente. */
  insufficient?: boolean;
  error?: string;
}

const DEMO: PurchaseResult = {
  ok: false,
  persisted: false,
  wonCardId: null,
  newBalance: null,
  newQuantity: null,
  isNew: false,
};

/**
 * Compra un cofre vía el RPC transaccional `purchase_chest`. El costo y las
 * probabilidades son autoritativos del servidor. En modo demo devuelve
 * persisted=false y el frontend simula la apertura localmente.
 */
export async function purchaseChest(
  chestType: ChestType,
  cost: number,
): Promise<PurchaseResult> {
  const supabase = getSupabase();
  if (!supabase) return DEMO;

  const { data, error } = await supabase.rpc("purchase_chest", {
    p_chest_cost: cost,
    p_chest_type: chestType,
  });

  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error("[purchaseChest] RPC error:", error.message);
    return { ...DEMO, persisted: true, insufficient, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ...DEMO, persisted: true, error: "Respuesta vacía del servidor" };
  }

  return {
    ok: true,
    persisted: true,
    wonCardId: row.won_card_id,
    newBalance: row.new_balance,
    newQuantity: row.new_quantity,
    isNew: row.is_new,
  };
}
