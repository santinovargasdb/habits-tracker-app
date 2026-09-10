import type {
  Card,
  CardRarity,
  ChestType,
  Deck,
  FundType,
  Habit,
  HabitStatus,
  Investment,
  OwnedCard,
  RouletteColor,
  TimeBlock,
} from "@/lib/types";

// -----------------------------------------------------------------------------
// Economía base
//   NONE = 0 · MET = 50 · SURPASSED = 150
//   El delta al cambiar de estado es REWARD[nuevo] - REWARD[anterior].
// -----------------------------------------------------------------------------
export const STATUS_REWARD: Record<HabitStatus, number> = {
  NONE: 0,
  MET: 50,
  SURPASSED: 150,
};

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

// -----------------------------------------------------------------------------
// Hábitos base (fallback demo).  Los UUIDs coinciden con supabase/seed.sql,
// así la app es totalmente explorable aunque Supabase no esté configurado.
// -----------------------------------------------------------------------------
export const SEED_HABITS: Habit[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Despertar 5:30 AM", time_block: "Madrugada", sort_order: 1 },
  { id: "22222222-2222-2222-2222-222222222222", name: "Trabajo (Mañana)", time_block: "Madrugada", sort_order: 2 },
  { id: "33333333-3333-3333-3333-333333333333", name: "Lectura en el tren", time_block: "Viaje", sort_order: 3 },
  { id: "44444444-4444-4444-4444-444444444444", name: "Repaso de Kanjis", time_block: "Viaje", sort_order: 4 },
  { id: "55555555-5555-5555-5555-555555555555", name: "Entrenar MMA (15:30 - 17:00)", time_block: "Tarde", sort_order: 5 },
  { id: "66666666-6666-6666-6666-666666666666", name: "Preparación Álgebra/Entropía", time_block: "Tarde", sort_order: 6 },
  { id: "77777777-7777-7777-7777-777777777777", name: "Colegio secundario", time_block: "Noche", sort_order: 7 },
  { id: "88888888-8888-8888-8888-888888888888", name: "Cierre a las 22:00", time_block: "Noche", sort_order: 8 },
];

// =============================================================================
// Paso 2 — Cartas y mazo
// =============================================================================

/** Pago con multiplicador del mazo (espeja round() del RPC en Postgres). */
export function computeAward(base: number, multiplierPercent: number): number {
  return Math.round((base * (100 + multiplierPercent)) / 100);
}

export const DECK_SIZE = 8;
export const EMPTY_DECK: Deck = Array(DECK_SIZE).fill(null);

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

// Cartas base (fallback demo, coinciden con supabase/02_cards_deck.sql).
export const SEED_CARDS: Card[] = [
  {
    id: "aaaa1111-1111-1111-1111-111111111111",
    name: "Libro de Viaje",
    rarity: "Common",
    target_block: "Viaje",
    multiplier_percent: 10,
    description:
      "Aprovechá cada trayecto. +10% de monedas en los hábitos del bloque Viaje.",
  },
  {
    id: "bbbb2222-2222-2222-2222-222222222222",
    name: "Foco en la Ecuación",
    rarity: "Rare",
    target_block: "Tarde",
    multiplier_percent: 15,
    description:
      "Concentración total sobre el problema. +15% de monedas en el bloque Tarde.",
  },
  {
    id: "cccc3333-3333-3333-3333-333333333333",
    name: "Cinturón Naranja",
    rarity: "Epic",
    target_block: "Tarde",
    multiplier_percent: 20,
    description: "Disciplina marcial pasiva. +20% de monedas en el bloque Tarde.",
  },
  {
    id: "dddd4444-4444-4444-4444-444444444444",
    name: "Voluntad de Acero",
    rarity: "Legendary",
    target_block: "Madrugada",
    multiplier_percent: 25,
    description: "Dominá el amanecer. +25% de monedas en el bloque Madrugada.",
  },
];

/** Inventario demo: el usuario posee una copia de cada carta. */
export const DEMO_INVENTORY: OwnedCard[] = SEED_CARDS.map((card) => ({
  card,
  quantity: 1,
  level: 1,
}));

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

export interface ChestConfig {
  type: ChestType;
  name: string;
  cost: number;
  icon: string;
  accent: string;
  blurb: string;
  odds: ChestOdds;
}

// ⚠️ Estas probabilidades son sólo para mostrar en la UI y simular en modo demo.
// En modo con Supabase, la fuente de verdad es el RPC purchase_chest (servidor).
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

/** Elige una rareza según los pesos del cofre (espeja el RNG del RPC). */
export function rollRarity(odds: ChestOdds): CardRarity {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const rarity of RARITY_SEQUENCE) {
    acc += odds[rarity];
    if (roll < acc) return rarity;
  }
  return "Legendary";
}

/** Carta aleatoria de una rareza; si no hay, cae a cualquiera del catálogo. */
export function pickRandomCardOfRarity(
  cards: Card[],
  rarity: CardRarity,
): Card | undefined {
  const pool = cards.filter((c) => c.rarity === rarity);
  const list = pool.length > 0 ? pool : cards;
  if (list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

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

/** Inversiones demo (ambos fondos en 0). */
export const DEMO_INVESTMENTS: Investment[] = [
  {
    id: "demo-conservative",
    fund_type: "CONSERVATIVE",
    invested_amount: 0,
    last_compounded_at: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "demo-aggressive",
    fund_type: "AGGRESSIVE",
    invested_amount: 0,
    last_compounded_at: "1970-01-01T00:00:00.000Z",
  },
];

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

/** Pago TOTAL sobre la apuesta: Verde ×14 · Rojo/Negro ×2. */
export function rouletteMultiplier(color: RouletteColor): number {
  return color === "GREEN" ? 14 : 2;
}

/** RNG de la casilla ganadora (0..36) — modo demo, espeja el RPC. */
export function spinRouletteNumber(): number {
  return Math.floor(Math.random() * 37);
}

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
