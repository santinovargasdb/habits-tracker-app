"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setDeckSlot } from "@/actions/deck";
import { DECK_SIZE, EMPTY_DECK, effectiveMultiplier } from "@/lib/constants";
import type { Card, Deck, OwnedCard, TimeBlock } from "@/lib/types";

interface GameContextValue {
  cards: Card[];
  inventory: OwnedCard[];
  deck: Deck;
  configured: boolean;
  cardById: (id: string | null) => Card | undefined;
  /** Suma de multiplier_percent de cartas equipadas que afectan al bloque. */
  multiplierForBlock: (block: TimeBlock) => number;
  /** Índice de slot (0..7) donde está equipada la carta, o -1. */
  slotOf: (cardId: string) => number;
  isEquipped: (cardId: string) => boolean;
  /** Primer slot vacío (0..7), o -1 si el mazo está lleno. */
  firstEmptySlot: () => number;
  equip: (cardId: string, slotIndex: number) => void;
  unequip: (slotIndex: number) => void;
  /** Suma una carta al inventario (o incrementa su cantidad). Para el gacha. */
  applyCardWin: (cardId: string, absoluteQuantity?: number) => void;
  /** Aplica una mejora de nivel a una carta del inventario. */
  applyUpgrade: (cardId: string, level: number, quantity: number) => void;
  /** Nivel de una carta en el inventario (1 si no está). */
  levelOf: (cardId: string) => number;
  lastError: string | null;
  clearError: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({
  cards,
  inventory: initialInventory,
  initialDeck,
  configured,
  children,
}: {
  cards: Card[];
  inventory: OwnedCard[];
  initialDeck: Deck;
  configured: boolean;
  children: ReactNode;
}) {
  const [deck, setDeck] = useState<Deck>(() => normalizeDeck(initialDeck));
  const [inventory, setInventory] = useState<OwnedCard[]>(initialInventory);
  const [lastError, setLastError] = useState<string | null>(null);

  const cardMap = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  const cardById = useCallback(
    (id: string | null) => (id ? cardMap.get(id) : undefined),
    [cardMap],
  );

  // Nivel por carta (para el multiplicador efectivo).
  const levelMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of inventory) m.set(o.card.id, o.level);
    return m;
  }, [inventory]);

  const levelOf = useCallback(
    (cardId: string) => levelMap.get(cardId) ?? 1,
    [levelMap],
  );

  const multiplierForBlock = useCallback(
    (block: TimeBlock) => {
      let total = 0;
      for (const id of deck) {
        if (!id) continue;
        const card = cardMap.get(id);
        if (!card) continue;
        if (card.target_block === null || card.target_block === block) {
          total += effectiveMultiplier(
            card.multiplier_percent,
            levelMap.get(id) ?? 1,
          );
        }
      }
      return total;
    },
    [deck, cardMap, levelMap],
  );

  const slotOf = useCallback(
    (cardId: string) => deck.findIndex((id) => id === cardId),
    [deck],
  );
  const isEquipped = useCallback(
    (cardId: string) => deck.includes(cardId),
    [deck],
  );
  const firstEmptySlot = useCallback(
    () => deck.findIndex((id) => id === null),
    [deck],
  );

  // Persiste + reconcilia; revierte en caso de error real (no en modo demo).
  const persist = useCallback(
    (slotIndex: number, cardId: string | null, previous: Deck) => {
      void (async () => {
        const res = await setDeckSlot(slotIndex + 1, cardId); // DB: 1..8
        if (configured && !res.persisted) {
          setDeck(previous);
          setLastError("No se pudo guardar el mazo. Reintentá.");
          return;
        }
        if (res.persisted && res.deck) {
          setDeck(normalizeDeck(res.deck));
        }
      })();
    },
    [configured],
  );

  const equip = useCallback(
    (cardId: string, slotIndex: number) => {
      if (slotIndex < 0 || slotIndex >= DECK_SIZE) return;
      const prev = deck;
      const next = [...prev];
      // Anti-duplicados: si ya estaba en otro slot, lo liberamos.
      const existing = next.indexOf(cardId);
      if (existing !== -1) next[existing] = null;
      next[slotIndex] = cardId;
      setDeck(next);
      persist(slotIndex, cardId, prev);
    },
    [deck, persist],
  );

  const unequip = useCallback(
    (slotIndex: number) => {
      if (slotIndex < 0 || slotIndex >= DECK_SIZE) return;
      const prev = deck;
      if (prev[slotIndex] === null) return;
      const next = [...prev];
      next[slotIndex] = null;
      setDeck(next);
      persist(slotIndex, null, prev);
    },
    [deck, persist],
  );

  const applyCardWin = useCallback(
    (cardId: string, absoluteQuantity?: number) => {
      setInventory((prev) => {
        const idx = prev.findIndex((o) => o.card.id === cardId);
        if (idx !== -1) {
          const next = [...prev];
          const qty = absoluteQuantity ?? next[idx].quantity + 1;
          next[idx] = { ...next[idx], quantity: qty };
          return next;
        }
        const card = cardMap.get(cardId);
        if (!card) return prev;
        return [
          ...prev,
          { card, quantity: absoluteQuantity ?? 1, level: 1 },
        ];
      });
    },
    [cardMap],
  );

  const applyUpgrade = useCallback(
    (cardId: string, level: number, quantity: number) => {
      setInventory((prev) =>
        prev.map((o) =>
          o.card.id === cardId ? { ...o, level, quantity } : o,
        ),
      );
    },
    [],
  );

  const value: GameContextValue = {
    cards,
    inventory,
    deck,
    configured,
    cardById,
    multiplierForBlock,
    slotOf,
    isEquipped,
    firstEmptySlot,
    equip,
    unequip,
    applyCardWin,
    applyUpgrade,
    levelOf,
    lastError,
    clearError: () => setLastError(null),
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame debe usarse dentro de <GameProvider>");
  return ctx;
}

/** Garantiza un array de exactamente DECK_SIZE (rellena/recorta con null). */
function normalizeDeck(deck: Deck): Deck {
  const base = [...EMPTY_DECK];
  for (let i = 0; i < DECK_SIZE; i++) base[i] = deck[i] ?? null;
  return base;
}
