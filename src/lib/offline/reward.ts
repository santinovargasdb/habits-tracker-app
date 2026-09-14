import type { HabitStatus, HabitFrequency } from "@/lib/types";

const BASE: Record<HabitStatus, number> = { NONE: 0, MET: 50, SURPASSED: 150 };

/**
 * Cálculo optimista de monedas para el marcado offline. Espeja la fórmula de
 * `set_habit_status`: base 50/150 × factor de cadencia (×5 semanal) × (1 + bonus
 * del mazo). El servidor reconcilia al sincronizar, así que un desvío del bonus
 * se auto-corrige.
 */
export function optimisticReward(params: {
  status: HabitStatus;
  frequency: HabitFrequency;
  deckBonusPercent?: number;
}): number {
  const base = BASE[params.status] ?? 0;
  if (base === 0) return 0;
  const weekly = params.frequency === "weekly" ? 5 : 1;
  const bonus = params.deckBonusPercent ?? 0;
  return Math.round((base * weekly * (100 + bonus)) / 100);
}
