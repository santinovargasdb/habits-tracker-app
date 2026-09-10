"use server";

import { getSupabase } from "@/lib/supabase/server";
import type { Deck } from "@/lib/types";
import { DECK_SIZE } from "@/lib/constants";

export interface SetDeckResult {
  persisted: boolean;
  /** Mazo autoritativo (8 slots) devuelto por la DB, o null en modo demo/error. */
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

  const supabase = getSupabase();
  if (!supabase) {
    // Modo demo: el frontend conserva su mazo optimista.
    return { persisted: false, deck: null };
  }

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
