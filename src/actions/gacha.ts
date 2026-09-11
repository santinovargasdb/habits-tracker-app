"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import { GACHA_WEIGHTS } from "@/lib/constants";
import type { CardRarity } from "@/lib/types";

// -----------------------------------------------------------------------------
// Apertura de cofres (gacha) — RNG del lado del servidor.
//
// NOTA de arquitectura: el descuento del wallet se hace con un "lock optimista"
// (solo actualiza si el balance no cambió desde la lectura) para evitar doble
// gasto bajo concurrencia. El insert en user_inventory es en realidad
// insert-o-incremento porque hay unique(user_id, card_id). Para máxima atomicidad
// existe además el RPC transaccional purchase_chest; esta acción implementa la
// lógica pedida a nivel de aplicación.
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
  /** true si el fallo fue por saldo insuficiente. */
  insufficient?: boolean;
  /** Balance autoritativo tras el descuento (null si falló). */
  newBalance: number | null;
  /** Carta obtenida (null si falló). */
  card: OpenChestCard | null;
  /** true si es la primera copia de esa carta en el inventario. */
  isNew: boolean;
  /** Cantidad total de esa carta tras la apertura (null si falló). */
  quantity: number | null;
}

const RARITY_ORDER: CardRarity[] = ["Common", "Rare", "Epic", "Legendary"];

/** RNG con los pesos exactos de GACHA_WEIGHTS (common .60 / rare .25 / epic .10 / legendary .05). */
function rollRarity(): CardRarity {
  const roll = Math.random();
  let acc = 0;
  for (const rarity of RARITY_ORDER) {
    acc += GACHA_WEIGHTS[rarity];
    if (roll < acc) return rarity;
  }
  return "Legendary";
}

function fail(
  error: string,
  extra: Partial<OpenChestResult> = {},
): OpenChestResult {
  return {
    ok: false,
    error,
    newBalance: null,
    card: null,
    isNew: false,
    quantity: null,
    ...extra,
  };
}

/**
 * Abre un cofre de costo `cost`: valida sesión y saldo, descuenta el costo,
 * sortea una rareza, elige una carta al azar de esa rareza y la suma al
 * inventario. Devuelve el balance nuevo y la carta obtenida.
 */
export async function openChest(cost: number): Promise<OpenChestResult> {
  if (!Number.isFinite(cost) || cost < 0) return fail("Costo inválido.");

  const supabase = await getSupabaseOrThrow();

  // 1) Validar la sesión.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("No autenticado.");
  const uid = user.id;

  // 2) Leer el balance actual y validar que alcance.
  const { data: wallet, error: wErr } = await supabase
    .from("wallet")
    .select("balance")
    .eq("user_id", uid)
    .maybeSingle();
  if (wErr || !wallet) return fail("No se pudo leer la billetera.");
  const balance = wallet.balance ?? 0;
  if (balance < cost) return fail("Saldo insuficiente.", { insufficient: true });

  // 3) Descontar el costo con lock optimista (evita doble gasto concurrente).
  const { data: updated, error: uErr } = await supabase
    .from("wallet")
    .update({ balance: balance - cost })
    .eq("user_id", uid)
    .eq("balance", balance)
    .select("balance")
    .maybeSingle();
  if (uErr || !updated) {
    return fail("No se pudo descontar el costo. Reintentá.");
  }
  const newBalance = updated.balance ?? balance - cost;

  // 4) RNG de rareza.
  const rarity = rollRarity();

  // 5) Carta aleatoria de esa rareza (fallback al catálogo entero si estuviera vacía).
  let pool = (
    await supabase.from("cards").select("*").eq("rarity", rarity)
  ).data as Array<Record<string, unknown>> | null;
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

  // 6) Sumar al inventario: insert nuevo o incremento de cantidad (unique user+card).
  const { data: existing } = await supabase
    .from("user_inventory")
    .select("quantity")
    .eq("user_id", uid)
    .eq("card_id", cardId)
    .maybeSingle();

  let quantity: number;
  let isNew: boolean;
  if (existing) {
    quantity = (existing.quantity ?? 1) + 1;
    isNew = false;
    const { error } = await supabase
      .from("user_inventory")
      .update({ quantity })
      .eq("user_id", uid)
      .eq("card_id", cardId);
    if (error) return fail("No se pudo guardar la carta.");
  } else {
    quantity = 1;
    isNew = true;
    const { error } = await supabase
      .from("user_inventory")
      .insert({ user_id: uid, card_id: cardId, quantity: 1, level: 1 });
    if (error) return fail("No se pudo guardar la carta.");
  }

  return { ok: true, newBalance, card, isNew, quantity };
}
