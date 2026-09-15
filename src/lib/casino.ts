// Matemática de los juegos de casino con multiplicador (Minas, Pollito).
// Espeja los RPCs de Supabase (17_casino_mines.sql / 18_casino_chicken.sql):
// ambos usan el mismo house edge y las mismas fórmulas. El RPC es la autoridad
// del pago; esto se usa para los hints de la UI y para testear la fórmula.

export const CASINO_EDGE = 0.97;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Multiplicador de Minas tras `picks` casillas seguras con `mines` minas (25 casillas). */
export function minesMultiplier(mines: number, picks: number): number {
  if (picks <= 0) return 1;
  const safe = 25 - mines;
  let p = 1;
  for (let i = 0; i < picks; i++) {
    p *= (safe - i) / (25 - i);
  }
  return round2(CASINO_EDGE / p);
}

/** Multiplicador del Pollito en el carril `lane` (supervivencia 0.75 por carril). */
export function chickenMultiplier(lane: number): number {
  if (lane <= 0) return 1;
  return round2(CASINO_EDGE / Math.pow(0.75, lane));
}
