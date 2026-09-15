"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setDeckSlot, toggleEquipCard } from "@/actions/deck";
import {
  DECK_SIZE,
  EMPTY_DECK,
  MAX_EQUIPPED,
} from "@/lib/constants";
import { equippedMultiplierForBlock } from "@/lib/deck";
import type { Card, Deck, OwnedCard, TimeBlock } from "@/lib/types";

interface GameContextValue {
  cards: Card[];
  inventory: OwnedCard[];
  deck: Deck;
  cardById: (id: string | null) => Card | undefined;
  /** Suma del multiplicador efectivo (con nivel) de las cartas equipadas que aplican al bloque. */
  multiplierForBlock: (block: TimeBlock) => number;
  /** Índice de slot (0..7) donde está equipada la carta, o -1. */
  slotOf: (cardId: string) => number;
  isEquipped: (cardId: string) => boolean;
  /** Primer slot vacío (0..7), o -1 si el mazo está lleno. */
  firstEmptySlot: () => number;
  equip: (cardId: string, slotIndex: number) => void;
  unequip: (slotIndex: number) => void;
  // --- Mazo activo por is_equipped (máx MAX_EQUIPPED) ---
  /** Cantidad de cartas equipadas actualmente. */
  equippedCount: number;
  /** Tope duro de cartas equipables. */
  maxEquipped: number;
  /** Equipa/desequipa una carta del inventario (persiste + reconcilia). */
  toggleEquip: (inventoryId: string) => void;
  /** Suma una carta al inventario (o incrementa su cantidad). Para el gacha. */
  applyCardWin: (
    cardId: string,
    inventoryId: string,
    absoluteQuantity?: number,
  ) => void;
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
  children,
}: {
  cards: Card[];
  inventory: OwnedCard[];
  initialDeck: Deck;
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
    (block: TimeBlock) => equippedMultiplierForBlock(inventory, block),
    [inventory],
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

  // Persiste + reconcilia; revierte en caso de error.
  const persist = useCallback(
    (slotIndex: number, cardId: string | null, previous: Deck) => {
      void (async () => {
        const res = await setDeckSlot(slotIndex + 1, cardId); // DB: 1..8
        if (!res.persisted) {
          setDeck(previous);
          setLastError("No se pudo guardar el mazo. Reintentá.");
          return;
        }
        if (res.deck) {
          setDeck(normalizeDeck(res.deck));
        }
      })();
    },
    [],
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
    (cardId: string, inventoryId: string, absoluteQuantity?: number) => {
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
          {
            id: inventoryId,
            card,
            quantity: absoluteQuantity ?? 1,
            level: 1,
            is_equipped: false,
          },
        ];
      });
    },
    [cardMap],
  );

  // Cantidad equipada (mazo activo por is_equipped).
  const equippedCount = inventory.filter((o) => o.is_equipped).length;

  // Equipa/desequipa: optimista + persistencia; respeta el tope duro.
  const toggleEquip = useCallback(
    (inventoryId: string) => {
      const item = inventory.find((o) => o.id === inventoryId);
      if (!item) return;
      const next = !item.is_equipped;
      const count = inventory.filter((o) => o.is_equipped).length;
      if (next && count >= MAX_EQUIPPED) {
        setLastError(`No podés equipar más de ${MAX_EQUIPPED} cartas.`);
        return;
      }

      // Optimista.
      setInventory((prev) =>
        prev.map((o) =>
          o.id === inventoryId ? { ...o, is_equipped: next } : o,
        ),
      );

      void (async () => {
        const res = await toggleEquipCard(inventoryId);
        if (!res.ok) {
          // Rollback al estado previo.
          setInventory((prev) =>
            prev.map((o) =>
              o.id === inventoryId
                ? { ...o, is_equipped: item.is_equipped }
                : o,
            ),
          );
          setLastError(res.error ?? "No se pudo equipar la carta.");
          return;
        }
        // Reconciliación con la verdad del servidor.
        setInventory((prev) =>
          prev.map((o) =>
            o.id === inventoryId ? { ...o, is_equipped: res.isEquipped } : o,
          ),
        );
      })();
    },
    [inventory],
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
    cardById,
    multiplierForBlock,
    slotOf,
    isEquipped,
    firstEmptySlot,
    equip,
    unequip,
    equippedCount,
    maxEquipped: MAX_EQUIPPED,
    toggleEquip,
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
