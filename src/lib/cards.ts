import type { Card, CardRarity, TimeBlock } from "@/lib/types";
import { normalizeTimeBlock } from "@/lib/constants";

/**
 * Normaliza una fila cruda de `public.cards` (que puede venir de prod con
 * columnas divergentes) a nuestro tipo `Card`.
 * - `multiplier_percent`: entero del catálogo; si viniera sólo `multiplier`
 *   (numeric, PostgREST lo manda como string tipo "1.10"), se deriva a %.
 * - arte: `icon_url ?? image_url`.
 */
export function rowToCard(row: Record<string, unknown>): Card {
  const mp = row.multiplier_percent;
  const mult = row.multiplier;
  let multiplier_percent = 0;
  if (typeof mp === "number") {
    multiplier_percent = mp;
  } else if (mult != null && !Number.isNaN(Number(mult))) {
    multiplier_percent = Math.round((Number(mult) - 1) * 100);
  }
  return {
    id: String(row.id),
    name: String(row.name ?? "Carta"),
    rarity: (row.rarity as CardRarity) ?? "Common",
    target_block:
      row.target_block == null ? null : normalizeTimeBlock(row.target_block),
    multiplier_percent,
    description: String(row.description ?? ""),
    image_url: (row.icon_url ?? row.image_url ?? null) as string | null,
  };
}
