"use client";

import { useState } from "react";
import { ArrowRight, Check, Coins, Plus, Sparkles } from "lucide-react";
import { GameCard } from "@/components/game-card";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { upgradeCard } from "@/actions/cards";
import { useGame } from "@/lib/game-context";
import { useWallet } from "@/lib/wallet-context";
import {
  DECK_SIZE,
  RARITY_META,
  TIME_BLOCK_META,
  TIME_BLOCK_ORDER,
  cardArt,
  dupsRequired,
  effectiveMultiplier,
  isMaxLevel,
  upgradeCost,
} from "@/lib/constants";
import type { Card } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function DeckView() {
  const {
    deck,
    inventory,
    configured,
    cardById,
    slotOf,
    isEquipped,
    firstEmptySlot,
    multiplierForBlock,
    levelOf,
    equip,
    unequip,
    applyUpgrade,
  } = useGame();
  const { balance, setBalance, addToBalance } = useWallet();

  const [selected, setSelected] = useState<Card | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [flash, setFlash] = useState(false);

  const equippedCount = deck.filter(Boolean).length;

  const activeBoosts = TIME_BLOCK_ORDER.map((block) => ({
    block,
    pct: multiplierForBlock(block),
  })).filter((b) => b.pct > 0);

  function showNote(msg: string) {
    setNote(msg);
    window.setTimeout(() => setNote(null), 2600);
  }

  function handleEquip(card: Card) {
    const slot = firstEmptySlot();
    if (slot === -1) {
      showNote("Mazo lleno — quitá una carta para hacer lugar.");
      return;
    }
    equip(card.id, slot);
    setSelected(null);
  }

  function handleUnequip(card: Card) {
    const slot = slotOf(card.id);
    if (slot !== -1) unequip(slot);
    setSelected(null);
  }

  async function handleUpgrade(card: Card) {
    const owned = inventory.find((o) => o.card.id === card.id);
    if (!owned || upgrading) return;

    const lvl = owned.level;
    if (isMaxLevel(lvl)) return;
    const dups = dupsRequired(lvl);
    const cost = upgradeCost(lvl);
    if (owned.quantity < dups) {
      showNote(`Necesitás ${dups} duplicados.`);
      return;
    }
    if (balance < cost) {
      showNote("Saldo insuficiente.");
      return;
    }

    setUpgrading(true);
    setFlash(true);

    // Optimista
    addToBalance(-cost);
    applyUpgrade(card.id, lvl + 1, owned.quantity - dups);

    try {
      const res = await upgradeCard(card.id);
      if (configured && !res.ok) {
        addToBalance(cost);
        applyUpgrade(card.id, lvl, owned.quantity);
        showNote(
          res.insufficient ? "Requisitos no cumplidos." : "No se pudo mejorar.",
        );
        return;
      }
      if (res.ok) {
        if (res.newBalance !== null) setBalance(res.newBalance);
        if (res.newLevel !== null && res.newQuantity !== null) {
          applyUpgrade(card.id, res.newLevel, res.newQuantity);
        }
      }
    } finally {
      setUpgrading(false);
      window.setTimeout(() => setFlash(false), 700);
    }
  }

  const selectedEquipped = selected ? isEquipped(selected.id) : false;
  const selectedSlot = selected ? slotOf(selected.id) : -1;

  // Datos de mejora de la carta seleccionada (recalculados en vivo).
  const owned = selected
    ? inventory.find((o) => o.card.id === selected.id)
    : undefined;
  const lvl = owned?.level ?? 1;
  const qty = owned?.quantity ?? 0;
  const atMax = isMaxLevel(lvl);
  const curMult = selected
    ? effectiveMultiplier(selected.multiplier_percent, lvl)
    : 0;
  const nextMult = selected
    ? effectiveMultiplier(selected.multiplier_percent, lvl + 1)
    : 0;
  const reqDups = dupsRequired(lvl);
  const reqCost = upgradeCost(lvl);
  const hasDups = qty >= reqDups;
  const hasCoins = balance >= reqCost;
  const canUpgrade = !atMax && hasDups && hasCoins && !upgrading;

  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      {/* ------------------------------------------------------------- MAZO */}
      <section className="animate-rise">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
              Mazo activo
            </p>
            <h1 className="mt-1 font-display text-[26px] font-extrabold tracking-tight text-fg">
              Tu Mazo
            </h1>
          </div>
          <span className="font-mono text-sm font-bold tabular-nums text-muted">
            {equippedCount}
            <span className="text-muted/50">/{DECK_SIZE}</span>
          </span>
        </div>

        {activeBoosts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {activeBoosts.map(({ block, pct }) => {
              const meta = TIME_BLOCK_META[block];
              return (
                <span
                  key={block}
                  className="flex items-center gap-1 rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[11px] font-medium"
                  style={{ color: meta.accent }}
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                  <span className="font-mono font-bold text-gold">+{pct}%</span>
                </span>
              );
            })}
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: DECK_SIZE }).map((_, i) => {
            const card = cardById(deck[i]);
            if (card) {
              return (
                <button
                  key={i}
                  onClick={() => setSelected(card)}
                  className="aspect-[3/4] transition-transform active:scale-95"
                  aria-label={`Slot ${i + 1}: ${card.name}`}
                >
                  <GameCard card={card} size="sm" level={levelOf(card.id)} />
                </button>
              );
            }
            return (
              <div
                key={i}
                className="grid aspect-[3/4] place-items-center rounded-2xl border border-dashed border-line bg-ink-2/60"
                aria-label={`Slot ${i + 1} vacío`}
              >
                <Plus className="h-5 w-5 text-line" strokeWidth={2.5} />
              </div>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------- INVENTARIO */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-gold" strokeWidth={2.2} />
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-fg">
            Inventario
          </h2>
          <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            {inventory.length} cartas
          </span>
        </div>

        {inventory.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface/70 px-4 py-8 text-center text-sm text-muted">
            Todavía no tenés cartas.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {inventory.map(({ card, quantity, level }) => {
              const equipped = isEquipped(card.id);
              return (
                <button
                  key={card.id}
                  onClick={() => setSelected(card)}
                  className="relative aspect-[3/4] transition-transform active:scale-95"
                  aria-label={card.name}
                >
                  <GameCard
                    card={card}
                    size="sm"
                    level={level}
                    className={cn(equipped && "opacity-60")}
                  />
                  {equipped && (
                    <span className="absolute -right-1 -top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-met text-ink shadow-lg">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                  {quantity > 1 && (
                    <span className="absolute -bottom-1 -right-1 z-20 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-bold text-fg ring-1 ring-line">
                      ×{quantity}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {note && (
        <div
          role="alert"
          className="animate-rise fixed inset-x-0 bottom-24 z-[70] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-gold/40 bg-surface px-4 py-3 text-center text-sm text-fg shadow-2xl"
        >
          {note}
        </div>
      )}

      {/* --------------------------------------------------------- DRAWER */}
      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        className="max-h-[88vh] overflow-y-auto"
      >
        {selected && (
          <div className="px-5 pt-4">
            <div className="flex gap-4">
              <div
                className={cn(
                  "h-44 w-32 shrink-0 rounded-2xl",
                  flash && "animate-level-flash",
                )}
              >
                <GameCard card={selected} size="lg" level={lvl} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <span
                  className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: RARITY_META[selected.rarity].color }}
                >
                  {RARITY_META[selected.rarity].label}
                </span>
                <h3 className="mt-1 font-display text-xl font-extrabold leading-tight text-fg">
                  {selected.name}
                </h3>
                <p className="mt-2 text-[13px] leading-snug text-muted">
                  {selected.description}
                </p>
                {selectedEquipped && (
                  <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-met/15 px-2.5 py-1 text-[11px] font-semibold text-met">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Equipada · slot {selectedSlot + 1}
                  </span>
                )}
              </div>
            </div>

            {/* Equipar / Quitar */}
            <div className="mt-5 flex gap-2.5">
              {selectedEquipped ? (
                <Button
                  variant="surface"
                  size="lg"
                  className="flex-1 border-danger/40 text-danger hover:border-danger hover:text-danger"
                  onClick={() => handleUnequip(selected)}
                >
                  Quitar del mazo
                </Button>
              ) : (
                <Button
                  variant="gold"
                  size="lg"
                  className="flex-1"
                  onClick={() => handleEquip(selected)}
                >
                  <span className="text-base">{cardArt(selected)}</span>
                  Equipar
                </Button>
              )}
              <Button variant="ghost" size="lg" onClick={() => setSelected(null)}>
                Cerrar
              </Button>
            </div>

            {/* Mejora de nivel */}
            {owned && (
              <div className="mt-4 rounded-2xl border border-line bg-ink-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      Actual
                    </p>
                    <p className="font-display text-sm font-bold text-fg">
                      Nivel {lvl}{" "}
                      <span className="font-mono text-gold">+{curMult}%</span>
                    </p>
                  </div>
                  {atMax ? (
                    <Badge variant="gold" size="md">
                      Nivel máximo
                    </Badge>
                  ) : (
                    <>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-muted"
                        strokeWidth={2.4}
                      />
                      <div className="text-right">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                          Siguiente
                        </p>
                        <p className="font-display text-sm font-bold text-fg">
                          Nivel {lvl + 1}{" "}
                          <span className="font-mono text-met">
                            +{nextMult}%
                          </span>
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {!atMax && (
                  <>
                    <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[12px]">
                      <span
                        className={cn(
                          "flex items-center gap-1.5",
                          hasDups ? "text-met" : "text-muted",
                        )}
                      >
                        {hasDups && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        {Math.min(qty, reqDups)}/{reqDups} duplicados
                      </span>
                      <span
                        className={cn(
                          "flex items-center gap-1",
                          hasCoins ? "text-gold" : "text-muted",
                        )}
                      >
                        <Coins className="h-3.5 w-3.5" strokeWidth={2.5} />
                        {reqCost.toLocaleString("es-AR")}
                      </span>
                    </div>

                    <Button
                      variant="gold"
                      size="lg"
                      disabled={!canUpgrade}
                      onClick={() => handleUpgrade(selected)}
                      className="mt-3 w-full"
                    >
                      {!hasDups
                        ? `Faltan ${reqDups - qty} duplicado${reqDups - qty > 1 ? "s" : ""}`
                        : !hasCoins
                          ? `Faltan ${(reqCost - balance).toLocaleString("es-AR")} 🪙`
                          : upgrading
                            ? "Mejorando…"
                            : `Mejorar carta · ${reqCost.toLocaleString("es-AR")} 🪙`}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
