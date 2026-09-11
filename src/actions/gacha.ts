"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import { chestTierConfig } from "@/lib/constants";
import type { CardRarity, ChestTier } from "@/lib/types";

// -----------------------------------------------------------------------------
// Apertura de cofres (gacha) — RNG del lado del servidor, por tier.
//
// El cliente sólo manda el tier ('silver' | 'gold' | 'magical'); el costo y las
// probabilidades salen de CHEST_TIERS en el servidor (no se confía en el cliente).
//
// NOTA de arquitectura: el descuento del wallet usa un "lock optimista" (sólo
// actualiza si el balance no cambió desde la lectura) para evitar doble gasto.
// El alta en user_inventory es insert-o-incremento por el unique(user_id, card_id).
// -----------------------------------------------------------------------------

export interface OpenChestCard {
  id: string;
  name: string;
  rarity: CardRarity;
  /** URL del icono (lee icon_url o image_url, lo que exista en la DB). */
  image_url: string | null;
}

export interface OpenChestResult {
  ok: boolean;
  error?: string;
  insufficient?: boolean;
  /** Balance autoritativo tras el descuento (null si falló). */
  newBalance: number | null;
  /** Carta obtenida (null si falló). */
  card: OpenChestCard | null;
  /** id de la fila de user_inventory de la carta obtenida (para el estado local). */
  inventoryId: string | null;
  /** true si es la primera copia de esa carta en el inventario. */
  isNew: boolean;
  /** Cantidad total de esa carta tras la apertura (null si falló). */
  quantity: number | null;
}

const RARITY_ORDER: CardRarity[] = ["Common", "Rare", "Epic", "Legendary"];

/** RNG con los pesos del tier (deben sumar 1). */
function rollRarity(weights: Record<CardRarity, number>): CardRarity {
  const roll = Math.random();
  let acc = 0;
  for (const rarity of RARITY_ORDER) {
    acc += weights[rarity] ?? 0;
    if (roll < acc) return rarity;
  }
  // Fallback: última rareza con peso > 0.
  for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
    if ((weights[RARITY_ORDER[i]] ?? 0) > 0) return RARITY_ORDER[i];
  }
  return "Common";
}

function fail(error: string, extra: Partial<OpenChestResult> = {}): OpenChestResult {
  return {
    ok: false,
    error,
    newBalance: null,
    card: null,
    inventoryId: null,
    isNew: false,
    quantity: null,
    ...extra,
  };
}

/**
 * Abre un cofre del `chestType` indicado: valida sesión y saldo, descuenta el
 * costo del tier, sortea la rareza según los pesos del tier, elige una carta al
 * azar de esa rareza y la suma al inventario.
 */
export async function openChest(chestType: ChestTier): Promise<OpenChestResult> {
  const tier = chestTierConfig(chestType);
  if (!tier) return fail("Cofre inválido.");
  const cost = tier.cost;

  const supabase = await getSupabaseOrThrow();

  // 1) Validar la sesión.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("No autenticado.");
  const uid = user.id;

  // 2) Leer el balance y validar que alcance.
  const { data: wallet, error: wErr } = await supabase
    .from("wallet")
    .select("balance")
    .eq("user_id", uid)
    .maybeSingle();
  if (wErr || !wallet) return fail("No se pudo leer la billetera.");
  const balance = wallet.balance ?? 0;
  if (balance < cost) return fail("Saldo insuficiente.", { insufficient: true });

  // 3) Descontar con lock optimista (evita doble gasto concurrente).
  const { data: updated, error: uErr } = await supabase
    .from("wallet")
    .update({ balance: balance - cost })
    .eq("user_id", uid)
    .eq("balance", balance)
    .select("balance")
    .maybeSingle();
  if (uErr || !updated) return fail("No se pudo descontar el costo. Reintentá.");
  const newBalance = updated.balance ?? balance - cost;

  // 4) RNG de rareza según el tier.
  const rarity = rollRarity(tier.weights);

  // 5) Carta aleatoria de esa rareza (fallback al catálogo entero si estuviera vacía).
  let pool = (await supabase.from("cards").select("*").eq("rarity", rarity))
    .data as Array<Record<string, unknown>> | null;
  if (!pool || pool.length === 0) {
    pool = (await supabase.from("cards").select("*")).data as Array<
      Record<string, unknown>
    > | null;
  }
  if (!pool || pool.length === 0) return fail("No hay cartas en el catálogo.");

  const row = pool[Math.floor(Math.random() * pool.length)];
  const cardId = String(row.id);
  const card: OpenChestCard = {
    id: cardId,
    name: String(row.name ?? "Carta"),
    rarity: (row.rarity as CardRarity) ?? rarity,
    image_url: (row.icon_url ?? row.image_url ?? null) as string | null,
  };

  // 6) Sumar al inventario: insert nuevo o incremento (unique user+card).
  const { data: existing } = await supabase
    .from("user_inventory")
    .select("id, quantity")
    .eq("user_id", uid)
    .eq("card_id", cardId)
    .maybeSingle();

  let inventoryId: string;
  let quantity: number;
  let isNew: boolean;
  if (existing) {
    inventoryId = String(existing.id);
    quantity = (existing.quantity ?? 1) + 1;
    isNew = false;
    const { error } = await supabase
      .from("user_inventory")
      .update({ quantity })
      .eq("id", inventoryId)
      .eq("user_id", uid);
    if (error) return fail("No se pudo guardar la carta.");
  } else {
    quantity = 1;
    isNew = true;
    const { data: inserted, error } = await supabase
      .from("user_inventory")
      .insert({ user_id: uid, card_id: cardId, quantity: 1, level: 1 })
      .select("id")
      .single();
    if (error || !inserted) return fail("No se pudo guardar la carta.");
    inventoryId = String(inserted.id);
  }

  return { ok: true, newBalance, card, inventoryId, isNew, quantity };
}
