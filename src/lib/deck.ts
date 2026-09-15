import { effectiveMultiplier } from "@/lib/constants";
import type { OwnedCard, TimeBlock } from "@/lib/types";

/**
 * Suma el multiplicador EFECTIVO (base + bonus de nivel) de las cartas
 * equipadas que aplican a `block` (o globales, target_block null).
 * Espeja el cálculo server-side de `set_habit_status` (migración 19).
 */
export function equippedMultiplierForBlock(
  inventory: OwnedCard[],
  block: TimeBlock,
): number {
  let total = 0;
  for (const o of inventory) {
    if (!o.is_equipped) continue;
    const tb = o.card.target_block;
    if (tb === null || tb === block) {
      total += effectiveMultiplier(o.card.multiplier_percent, o.level);
    }
  }
  return total;
}
