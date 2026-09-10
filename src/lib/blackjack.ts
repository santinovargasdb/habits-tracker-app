import type { BlackjackResult } from "@/lib/types";

// -----------------------------------------------------------------------------
// Blackjack — Dojo Ledger (Paso 7)
// Utilidades de presentación para decodificar/pintar las cartas de la vista
// saneada que devuelve el servidor (supabase/07_casino_blackjack.sql).
//
// Representación de carta: entero 0..51.
//   rank = card % 13 → 0=As, 1..8 = 2..9, 9..12 = 10/J/Q/K
//   palo = ⌊card / 13⌋ → 0 ♠, 1 ♥, 2 ♦, 3 ♣  (sólo estético)
// -----------------------------------------------------------------------------

const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];

export function cardRankLabel(card: number): string {
  return RANK_LABELS[((card % 13) + 13) % 13];
}

export function cardSuitSymbol(card: number): string {
  return SUIT_SYMBOLS[Math.floor(card / 13) % 4];
}

/** ♥ y ♦ son rojos; ♠ y ♣ negros. */
export function cardIsRed(card: number): boolean {
  const suit = Math.floor(card / 13) % 4;
  return suit === 1 || suit === 2;
}

export function cardValue(card: number): number {
  const r = card % 13;
  if (r === 0) return 11; // As (se ajusta a 1 en handScore si conviene)
  if (r >= 9) return 10; // 10, J, Q, K
  return r + 1; // 2..9
}

/** Puntaje de una mano con ajuste de ases (11 → 1). */
export function handScore(cards: number[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c % 13;
    if (r === 0) {
      total += 11;
      aces += 1;
    } else if (r >= 9) {
      total += 10;
    } else {
      total += r + 1;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isBlackjack(cards: number[]): boolean {
  return cards.length === 2 && handScore(cards) === 21;
}

/** Blackjack natural paga 3:2 → devuelve 2.5× la apuesta (floor, como el RPC). */
export function blackjackPayout(bet: number): number {
  return bet + Math.floor((bet * 3) / 2);
}

/** Mazo de 52 cartas barajado (Fisher–Yates). */
export function makeShuffledDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// =============================================================================
// Texto de resultado (compartido por la UI)
// =============================================================================
export function resultText(result: BlackjackResult): {
  title: string;
  win: boolean;
  push: boolean;
} {
  switch (result) {
    case "PLAYER_BLACKJACK":
      return { title: "¡Blackjack! 3:2", win: true, push: false };
    case "PLAYER_WIN":
      return { title: "¡Ganaste!", win: true, push: false };
    case "DEALER_BLACKJACK":
      return { title: "Blackjack del crupier", win: false, push: false };
    case "DEALER_WIN":
      return { title: "Gana el crupier", win: false, push: false };
    case "PLAYER_BUST":
      return { title: "Te pasaste", win: false, push: false };
    case "PUSH":
      return { title: "Empate (push)", win: false, push: true };
    default:
      return { title: "", win: false, push: false };
  }
}
