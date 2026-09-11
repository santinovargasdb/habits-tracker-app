"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import type { Deck } from "@/lib/types";
import { DECK_SIZE, MAX_EQUIPPED } from "@/lib/constants";

export interface SetDeckResult {
  persisted: boolean;
  /** Mazo autoritativo (8 slots) devuelto por la DB, o null ante error. */
  deck: Deck | null;
  error?: string;
}

/**
 * Equipa (cardId) o quita (null) una carta en un slot 1..8 del mazo activo.
 * La deduplicación (una carta no puede estar en dos slots) la resuelve el RPC.
 */
export async function setDeckSlot(
  slotIndex: number,
  cardId: string | null,
): Promise<SetDeckResult> {
  if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > DECK_SIZE) {
    return { persisted: false, deck: null, error: "Slot inválido" };
  }

  const supabase = await getSupabaseOrThrow();

  const { data, error } = await supabase.rpc("set_deck_slot", {
    p_slot: slotIndex,
    p_card: cardId,
  });

  if (error) {
    console.error("[setDeckSlot] RPC error:", error.message);
    return { persisted: false, deck: null, error: error.message };
  }

  const deck = (Array.isArray(data) ? data : []) as Deck;
  return { persisted: true, deck };
}

// -----------------------------------------------------------------------------
// Mazo activo por `is_equipped` (máx MAX_EQUIPPED). Restricción dura: no se
// puede equipar una carta de más.
// -----------------------------------------------------------------------------
export interface ToggleEquipResult {
  ok: boolean;
  /** Estado final de la carta tras el toggle. */
  isEquipped: boolean;
  /** true si el fallo fue por llegar al límite de equipadas. */
  limitReached?: boolean;
  error?: string;
}

/**
 * Equipa/desequipa una carta del inventario (user_inventory.is_equipped).
 * Si se intenta equipar habiendo ya MAX_EQUIPPED equipadas, retorna error.
 */
export async function toggleEquipCard(
  inventoryId: string,
): Promise<ToggleEquipResult> {
  const supabase = await getSupabaseOrThrow();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, isEquipped: false, error: "No autenticado." };
  const uid = user.id;

  // Estado actual de la carta (y que pertenezca al usuario).
  const { data: row, error: rErr } = await supabase
    .from("user_inventory")
    .select("is_equipped")
    .eq("id", inventoryId)
    .eq("user_id", uid)
    .maybeSingle();
  if (rErr || !row) {
    return { ok: false, isEquipped: false, error: "Carta no encontrada." };
  }
  const current = row.is_equipped ?? false;

  // Al EQUIPAR, imponemos el tope duro de MAX_EQUIPPED.
  if (!current) {
    const { count, error: cErr } = await supabase
      .from("user_inventory")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("is_equipped", true);
    if (cErr) return { ok: false, isEquipped: current, error: "No se pudo verificar el mazo." };
    if ((count ?? 0) >= MAX_EQUIPPED) {
      return {
        ok: false,
        isEquipped: current,
        limitReached: true,
        error: `No podés equipar más de ${MAX_EQUIPPED} cartas.`,
      };
    }
  }

  const next = !current;
  const { error: uErr } = await supabase
    .from("user_inventory")
    .update({ is_equipped: next })
    .eq("id", inventoryId)
    .eq("user_id", uid);
  if (uErr) return { ok: false, isEquipped: current, error: "No se pudo actualizar." };

  return { ok: true, isEquipped: next };
}
