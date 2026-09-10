// =============================================================================
// Tipos del dominio — Dojo Ledger
// =============================================================================

export type TimeBlock = "Madrugada" | "Viaje" | "Tarde" | "Noche";

/**
 * Cadencia de un hábito.
 *   DAILY  — se registra y reinicia cada día (log por fecha del día).
 *   WEEKLY — vive en el Bloque Semanal: el log se ancla al inicio de semana
 *            (lunes), se mantiene toda la semana y se reinicia solo al arrancar
 *            un nuevo ciclo. Otorga ×5 de recompensa (ver WEEKLY_REWARD_MULTIPLIER).
 */
export type HabitFrequency = "DAILY" | "WEEKLY";

export type HabitStatus = "NONE" | "MET" | "SURPASSED";

export type CardRarity = "Common" | "Rare" | "Epic" | "Legendary";

export type ChestType = "BASICO" | "ORO" | "MAGICO";

export type FundType = "CONSERVATIVE" | "AGGRESSIVE";

// -----------------------------------------------------------------------------
// Casino (Paso 7)
// -----------------------------------------------------------------------------
export type RouletteColor = "RED" | "BLACK" | "GREEN";

export type BlackjackStatus = "PLAYER_TURN" | "DONE";

export type BlackjackResult =
  | "PLAYER_BLACKJACK"
  | "DEALER_BLACKJACK"
  | "PLAYER_WIN"
  | "DEALER_WIN"
  | "PUSH"
  | "PLAYER_BUST";

/**
 * Vista saneada de una mano de blackjack. Mientras es el turno del jugador, el
 * crupier expone SOLO su carta visible (`dealerHidden = true`); `dealerScore`
 * refleja únicamente las cartas visibles. Al terminar (`status = "DONE"`) se
 * revela toda la mano. Las cartas son enteros 0..51 (ver lib/blackjack.ts).
 */
export interface BlackjackView {
  status: BlackjackStatus;
  result: BlackjackResult | null;
  bet: number;
  playerCards: number[];
  playerScore: number;
  dealerCards: number[];
  dealerScore: number;
  dealerHidden: boolean;
  payout: number;
  newBalance: number | null;
}

export interface Habit {
  id: string;
  name: string;
  time_block: TimeBlock;
  sort_order: number;
  /** Cadencia del hábito. Por defecto "DAILY" (ver HabitFrequency). */
  frequency: HabitFrequency;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  date: string; // YYYY-MM-DD
  status: HabitStatus;
  coins_awarded: number;
}

export interface Wallet {
  id: string;
  balance: number;
}

/** Carta del catálogo. `target_block` null = global (afecta a todos). */
export interface Card {
  id: string;
  name: string;
  rarity: CardRarity;
  target_block: TimeBlock | null;
  multiplier_percent: number;
  description: string;
  /**
   * URL del icono oficial de la carta (columna `image_url` en la DB).
   * null / vacío → la UI cae al arte emoji de fallback (ver cardArt()).
   */
  image_url: string | null;
}

/** Carta poseída (catálogo + cantidad + nivel). */
export interface OwnedCard {
  card: Card;
  quantity: number;
  level: number;
}

/** Mazo activo: 8 slots; cada slot es un card_id o null (vacío). */
export type Deck = (string | null)[];

export interface Investment {
  id: string;
  fund_type: FundType;
  invested_amount: number;
  last_compounded_at: string;
}

/** Mapa habitId -> estado del log para un día concreto. */
export type LogMap = Record<string, HabitStatus>;

/** Mapa habitId -> monedas acreditadas por su estado actual. */
export type AwardMap = Record<string, number>;

/** Fila cruda (snake_case) que devuelven los RPCs de blackjack. */
export interface BlackjackRpcRow {
  status: BlackjackStatus;
  result: BlackjackResult | null;
  bet: number;
  player_cards: number[];
  player_score: number;
  dealer_cards: number[];
  dealer_score: number;
  dealer_hidden: boolean;
  payout: number;
  new_balance: number;
}

// -----------------------------------------------------------------------------
// Forma de la base de datos (referencia / documentación del esquema).
// El cliente de supabase-js se usa sin genéricos para evitar fricción de tipos
// en el MVP; los resultados se castean a estos tipos.
// -----------------------------------------------------------------------------
export interface Database {
  public: {
    Tables: {
      wallet: { Row: Wallet & { updated_at: string; singleton: boolean } };
      habits: { Row: Habit & { created_at: string } };
      logs: { Row: HabitLog & { created_at: string; updated_at: string } };
      cards: { Row: Card & { created_at: string } };
      user_inventory: {
        Row: { id: string; card_id: string; quantity: number; level: number };
      };
      active_deck: {
        Row: {
          id: string;
          slot_1: string | null;
          slot_2: string | null;
          slot_3: string | null;
          slot_4: string | null;
          slot_5: string | null;
          slot_6: string | null;
          slot_7: string | null;
          slot_8: string | null;
        };
      };
      investments: { Row: Investment };
    };
    Functions: {
      set_habit_status: {
        Args: { p_habit_id: string; p_date: string; p_status: HabitStatus };
        Returns: {
          balance: number;
          log_status: HabitStatus;
          coins_awarded: number;
        }[];
      };
      set_deck_slot: {
        Args: { p_slot: number; p_card: string | null };
        Returns: (string | null)[];
      };
      purchase_chest: {
        Args: { p_chest_cost: number; p_chest_type: ChestType };
        Returns: {
          won_card_id: string;
          new_balance: number;
          new_quantity: number;
          is_new: boolean;
        }[];
      };
      manage_investment: {
        Args: { p_action: string; p_fund: FundType; p_amount: number };
        Returns: { new_balance: number; new_invested: number }[];
      };
      calculate_daily_interest: {
        Args: Record<string, never>;
        Returns: Investment[];
      };
      spin_roulette: {
        Args: { p_bet_amount: number; p_choice: RouletteColor };
        Returns: {
          result_number: number;
          result_color: RouletteColor;
          won: boolean;
          payout: number;
          new_balance: number;
        }[];
      };
      bj_deal: { Args: { p_bet: number }; Returns: BlackjackRpcRow[] };
      bj_hit: { Args: Record<string, never>; Returns: BlackjackRpcRow[] };
      bj_stand: { Args: Record<string, never>; Returns: BlackjackRpcRow[] };
      upgrade_card: {
        Args: { p_card_id: string };
        Returns: {
          new_level: number;
          new_multiplier: number;
          new_quantity: number;
          new_balance: number;
        }[];
      };
    };
  };
}
