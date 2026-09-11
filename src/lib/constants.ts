import type {
  Card,
  CardRarity,
  ChestTier,
  ChestType,
  Deck,
  FundType,
  HabitStatus,
  RouletteColor,
  TimeBlock,
} from "@/lib/types";

// -----------------------------------------------------------------------------
// Economía: la recompensa (base + ×multiplier de los hábitos semanales + mult.
// del mazo) la calcula ÍNTEGRAMENTE el servidor en el RPC set_habit_status, que
// devuelve el balance nuevo y las monedas acreditadas. El cliente NO recalcula
// nada: confía en esos valores (ver src/actions/habits.ts y tracker-view.tsx).
// -----------------------------------------------------------------------------

/** Orden canónico de los bloques horarios en la UI. */
export const TIME_BLOCK_ORDER: TimeBlock[] = [
  "Madrugada",
  "Viaje",
  "Tarde",
  "Noche",
];

export interface TimeBlockMeta {
  label: string;
  tagline: string;
  icon: string;
  /** Color de acento del bloque (CSS). */
  accent: string;
  window: string;
}

export const TIME_BLOCK_META: Record<TimeBlock, TimeBlockMeta> = {
  Madrugada: {
    label: "Madrugada",
    tagline: "Antes del amanecer",
    icon: "🌅",
    accent: "#f4a15d",
    window: "05:00 – 08:00",
  },
  Viaje: {
    label: "Viaje",
    tagline: "En movimiento",
    icon: "🚄",
    accent: "#5eb0ef",
    window: "en tránsito",
  },
  Tarde: {
    label: "Tarde",
    tagline: "Cuerpo y mente",
    icon: "🥋",
    accent: "#ff7a4d",
    window: "15:00 – 19:00",
  },
  Noche: {
    label: "Noche",
    tagline: "Estudio y cierre",
    icon: "🌙",
    accent: "#9b8bf5",
    window: "19:00 – 22:00",
  },
};

// -----------------------------------------------------------------------------
// Bloque Semanal — identidad visual (placa dorada + badge de recompensa).
// Es un bloque especial que agrupa TODOS los hábitos WEEKLY, independientemente
// de su time_block, y se distingue del resto con acento dorado.
// -----------------------------------------------------------------------------
export interface WeeklyBlockMeta {
  label: string;
  tagline: string;
  icon: string;
  /** Acento dorado del bloque (CSS). */
  accent: string;
}

export const WEEKLY_BLOCK_META: WeeklyBlockMeta = {
  label: "Bloque Semanal",
  tagline: "Metas de largo aliento",
  icon: "⭐",
  accent: "#f6c445",
};

export interface StatusMeta {
  label: string;
  emoji: string;
  /** Color de acento del estado (CSS). */
  accent: string;
}

export const STATUS_META: Record<HabitStatus, StatusMeta> = {
  NONE: { label: "Nada", emoji: "❌", accent: "#6b6b78" },
  MET: { label: "Hecho", emoji: "✅", accent: "#3ecf8e" },
  SURPASSED: { label: "Superé", emoji: "🔥", accent: "#f6c445" },
};

/** El control de 3 estados, en orden de presentación. */
export const STATUS_SEQUENCE: HabitStatus[] = ["NONE", "MET", "SURPASSED"];

// =============================================================================
// Paso 2 — Cartas y mazo
// =============================================================================

export const DECK_SIZE = 8;
export const EMPTY_DECK: Deck = Array(DECK_SIZE).fill(null);

/** Tope duro de cartas equipadas (mazo activo por is_equipped). */
export const MAX_EQUIPPED = 4;

export interface RarityMeta {
  label: string;
  /** Color principal de la rareza (CSS). */
  color: string;
  /** Gradiente del marco de la carta. */
  frame: string;
  order: number;
}

export const RARITY_META: Record<CardRarity, RarityMeta> = {
  Common: {
    label: "Común",
    color: "#9aa4b2",
    frame: "linear-gradient(145deg, #aab3c0, #6b7280)",
    order: 0,
  },
  Rare: {
    label: "Rara",
    color: "#4aa3ff",
    frame: "linear-gradient(145deg, #7cc3ff, #2f6fd0)",
    order: 1,
  },
  Epic: {
    label: "Épica",
    color: "#b061ff",
    frame: "linear-gradient(145deg, #cf9bff, #7a2fd0)",
    order: 2,
  },
  Legendary: {
    label: "Legendaria",
    color: "#f6c445",
    frame: "linear-gradient(145deg, #ffe9a3, #f6c445, #ff7a3d)",
    order: 3,
  },
};

/**
 * Marco + fondo por rareza (estética Clash Royale). Clases Tailwind aplicadas
 * al contenedor de la carta; el glow/brillo extra de Legendary se refuerza con
 * la animación `animate-sheen` en el componente.
 */
export const RARITY_FRAME_CLASS: Record<CardRarity, string> = {
  Common: "border-slate-400 bg-slate-800/80",
  Rare: "border-amber-600 bg-amber-950/80",
  Epic: "border-purple-500 bg-purple-950/80",
  Legendary:
    "border-yellow-400 bg-yellow-950/90 shadow-lg shadow-yellow-500/20",
};

/** Arte (emoji) por carta — keyed por los UUIDs fijos del seed. */
export const CARD_ART: Record<string, string> = {
  "aaaa1111-1111-1111-1111-111111111111": "📖",
  "bbbb2222-2222-2222-2222-222222222222": "➗",
  "cccc3333-3333-3333-3333-333333333333": "🥋",
  "dddd4444-4444-4444-4444-444444444444": "🛡️",
};

/** Fallback de arte por rareza si el id no está mapeado. */
export const RARITY_ART: Record<CardRarity, string> = {
  Common: "🎴",
  Rare: "🔷",
  Epic: "🟣",
  Legendary: "👑",
};

export function cardArt(card: Pick<Card, "id" | "rarity">): string {
  return CARD_ART[card.id] ?? RARITY_ART[card.rarity];
}

// -----------------------------------------------------------------------------
// Niveles de carta (Paso 5) — espeja la lógica del RPC upgrade_card.
//   multiplicador efectivo = base + (nivel - 1) * LEVEL_MULTIPLIER_STEP
//   duplicados nivel L → L+1 = L + 1
//   costo nivel L → L+1      = L * UPGRADE_COST_STEP
// -----------------------------------------------------------------------------
export const LEVEL_MULTIPLIER_STEP = 5;
export const UPGRADE_COST_STEP = 500;
export const MAX_CARD_LEVEL = 10;

export function effectiveMultiplier(base: number, level: number): number {
  return base + Math.max(level - 1, 0) * LEVEL_MULTIPLIER_STEP;
}

export function dupsRequired(currentLevel: number): number {
  return currentLevel + 1;
}

export function upgradeCost(currentLevel: number): number {
  return currentLevel * UPGRADE_COST_STEP;
}

export function isMaxLevel(level: number): boolean {
  return level >= MAX_CARD_LEVEL;
}

// =============================================================================
// Paso 3 — Cofres y gacha (Mercado)
// =============================================================================

/** Orden de rarezas para el cálculo acumulado del RNG. */
export const RARITY_SEQUENCE: CardRarity[] = [
  "Common",
  "Rare",
  "Epic",
  "Legendary",
];

export type ChestOdds = Record<CardRarity, number>;

// -----------------------------------------------------------------------------
// Tiers de cofre del gacha — costo + pesos por rareza. Única fuente de verdad:
// el RNG server-side (src/actions/gacha.ts) y la UI del Mercado leen de acá.
// El servidor usa el `cost` del tier (no confía en un costo del cliente).
// -----------------------------------------------------------------------------
export interface ChestTierConfig {
  tier: ChestTier;
  name: string;
  cost: number;
  icon: string;
  accent: string;
  blurb: string;
  weights: Record<CardRarity, number>;
}

export const CHEST_TIERS: ChestTierConfig[] = [
  {
    tier: "silver",
    name: "Cofre de Plata",
    cost: 50,
    icon: "📦",
    accent: "#c9d1d9",
    blurb: "Barato y frecuente. Ideal para empezar la colección.",
    weights: { Common: 0.75, Rare: 0.2, Epic: 0.05, Legendary: 0.0 },
  },
  {
    tier: "gold",
    name: "Cofre de Oro",
    cost: 150,
    icon: "🎁",
    accent: "#f6c445",
    blurb: "Mayor chance de raras y épicas.",
    weights: { Common: 0.3, Rare: 0.5, Epic: 0.18, Legendary: 0.02 },
  },
  {
    tier: "magical",
    name: "Cofre Mágico",
    cost: 400,
    icon: "🔮",
    accent: "#b061ff",
    blurb: "Sólo cartas potentes. Chance real de Legendaria.",
    weights: { Common: 0.0, Rare: 0.2, Epic: 0.5, Legendary: 0.3 },
  },
];

export function chestTierConfig(tier: ChestTier): ChestTierConfig | undefined {
  return CHEST_TIERS.find((t) => t.tier === tier);
}

export interface ChestConfig {
  type: ChestType;
  name: string;
  cost: number;
  icon: string;
  accent: string;
  blurb: string;
  odds: ChestOdds;
}

// ⚠️ Estas probabilidades son sólo para mostrarlas en la UI. La fuente de verdad
// del gacha (costo y RNG) es el RPC purchase_chest en el servidor.
export const CHESTS: ChestConfig[] = [
  {
    type: "BASICO",
    name: "Cofre Básico",
    cost: 500,
    icon: "📦",
    accent: "#c9863f",
    blurb: "Un buen punto de partida para engrosar tu colección.",
    odds: { Common: 80, Rare: 18, Epic: 2, Legendary: 0 },
  },
  {
    type: "ORO",
    name: "Cofre de Oro",
    cost: 2000,
    icon: "🎁",
    accent: "#f6c445",
    blurb: "Mayores chances de cartas raras y épicas.",
    odds: { Common: 20, Rare: 65, Epic: 14, Legendary: 1 },
  },
  {
    type: "MAGICO",
    name: "Cofre Mágico",
    cost: 5000,
    icon: "🔮",
    accent: "#b061ff",
    blurb: "Sólo cartas potentes. Chance real de Legendaria.",
    odds: { Common: 0, Rare: 30, Epic: 60, Legendary: 10 },
  },
];

// =============================================================================
// Paso 4 — Finanzas (inversión + ruleta)
// =============================================================================

export interface FundMeta {
  name: string;
  short: string;
  icon: string;
  accent: string;
  rate: string;
  blurb: string;
}

export const FUND_META: Record<FundType, FundMeta> = {
  CONSERVATIVE: {
    name: "Bono Entropía",
    short: "Conservador",
    icon: "🏦",
    accent: "#3ecf8e",
    rate: "+1% diario fijo",
    blurb: "Crecimiento estable y garantizado.",
  },
  AGGRESSIVE: {
    name: "Fondo de Alto Riesgo",
    short: "Agresivo",
    icon: "🚀",
    accent: "#ff7a3d",
    rate: "70% +5% · 30% −3% por día",
    blurb: "Alta volatilidad, alto potencial.",
  },
};

export const FUND_ORDER: FundType[] = ["CONSERVATIVE", "AGGRESSIVE"];

// -----------------------------------------------------------------------------
// Ruleta europea por color (Paso 7) — 37 casillas: 18 rojas / 18 negras / 1 verde.
// El mapa de colores es el auténtico de la ruleta europea (alternan como en una
// mesa real). Espeja roulette_color(n) y spin_roulette del RPC.
// -----------------------------------------------------------------------------
export const ROULETTE_RED: number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];
export const ROULETTE_BLACK: number[] = [
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
];

export function rouletteColor(n: number): RouletteColor {
  if (n === 0) return "GREEN";
  return ROULETTE_RED.includes(n) ? "RED" : "BLACK";
}

/**
 * Orden FÍSICO de las casillas en la rueda europea (single-zero), en sentido
 * horario empezando por el 0. Lo usa la rueda visual (roulette-wheel.tsx) para
 * ubicar cada número y calcular el ángulo de frenado bajo la aguja superior.
 */
export const EUROPEAN_WHEEL: number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export interface RouletteColorMeta {
  key: RouletteColor;
  label: string;
  multiplier: number;
  slots: number;
  /** Color de acento (texto/glow). */
  accent: string;
  /** Fondo de la ficha/botón del color. */
  swatch: string;
  /** Color del texto sobre el swatch. */
  ink: string;
}

// Orden de presentación de los botones (verde al centro por ser el premio alto).
export const ROULETTE_COLORS: RouletteColorMeta[] = [
  { key: "RED",   label: "Rojo",  multiplier: 2,  slots: 18, accent: "#ff6b6b", swatch: "#c62b38", ink: "#fff5f5" },
  { key: "GREEN", label: "Verde", multiplier: 14, slots: 1,  accent: "#3ecf8e", swatch: "#1f7a52", ink: "#eafff5" },
  { key: "BLACK", label: "Negro", multiplier: 2,  slots: 18, accent: "#c7c9d4", swatch: "#15151d", ink: "#ededf2" },
];

export function rouletteColorMeta(color: RouletteColor): RouletteColorMeta {
  return ROULETTE_COLORS.find((c) => c.key === color) ?? ROULETTE_COLORS[0];
}
