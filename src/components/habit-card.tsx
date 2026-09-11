"use client";

import { useState } from "react";
import { STATUS_META, STATUS_SEQUENCE } from "@/lib/constants";
import type { HabitStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HabitCardProps {
  name: string;
  status: HabitStatus;
  /** Monedas acreditadas por este hábito (valor autoritativo del servidor). */
  reward: number;
  /** Multiplicador del mazo para el bloque (suma de % de cartas equipadas). */
  multiplierPercent: number;
  /** Color de acento del bloque horario. */
  accent: string;
  /** Índice global para escalonar la animación de entrada. */
  index: number;
  /** Hábito semanal: muestra el badge distintivo. */
  weekly?: boolean;
  /** Multiplicador de recompensa de la DB (para el badge "Semanal 🔥 x5"). */
  multiplier?: number;
  /**
   * Burst de monedas a animar. Lo dispara el padre con el delta REAL devuelto
   * por el RPC (el cliente ya no calcula recompensas). Cada burst trae un id
   * único para re-lanzar la animación.
   */
  burst?: { id: number; amount: number } | null;
  onChange: (next: HabitStatus) => void;
}

const ACTIVE_CLASS: Record<HabitStatus, string> = {
  NONE: "bg-surface-2 text-fg",
  MET: "bg-met text-ink shadow-[0_4px_14px_-4px_rgba(62,207,142,0.75)]",
  SURPASSED:
    "bg-gradient-to-br from-gold to-fire text-ink shadow-[0_5px_16px_-3px_rgba(246,196,69,0.8)]",
};

const CARD_STATE_CLASS: Record<HabitStatus, string> = {
  NONE: "border-line",
  MET: "border-met/35",
  SURPASSED: "border-gold/45 bg-gold/[0.045]",
};

export default function HabitCard({
  name,
  status,
  reward,
  multiplierPercent,
  accent,
  index,
  weekly = false,
  multiplier = 1,
  burst = null,
  onChange,
}: HabitCardProps) {
  // El burst lo controla el padre (con el delta real del RPC). Guardamos el
  // último id "consumido" para ocultarlo al terminar la animación sin efectos.
  const [dismissedBurst, setDismissedBurst] = useState<number | null>(null);
  const activeBurst =
    burst && burst.amount !== 0 && dismissedBurst !== burst.id ? burst : null;

  function handleSelect(next: HabitStatus) {
    if (next === status) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(12);
    }
    onChange(next);
  }

  const boosted = multiplierPercent > 0;

  return (
    <div
      className={cn(
        "animate-rise relative rounded-2xl border bg-surface/90 p-4 transition-colors duration-300",
        CARD_STATE_CLASS[status],
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      {activeBurst && (
        <span
          key={activeBurst.id}
          onAnimationEnd={() => setDismissedBurst(activeBurst.id)}
          className={cn(
            "animate-coin-float pointer-events-none absolute right-4 top-2.5 z-10 flex items-center gap-0.5 font-mono text-sm font-bold",
            activeBurst.amount > 0 ? "text-gold" : "text-danger",
          )}
        >
          {activeBurst.amount > 0 ? "+" : "−"}
          {Math.abs(activeBurst.amount)}
          <span className="text-[11px]">🪙</span>
        </span>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}80` }}
            aria-hidden
          />
          <h3 className="font-display text-[15px] font-semibold leading-tight text-fg">
            {name}
          </h3>
          {weekly && (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gradient-to-r from-gold/20 to-fire/15 px-2 py-0.5 font-mono text-[10px] font-bold text-gold">
              Semanal 🔥 x{multiplier}
            </span>
          )}
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 font-mono text-xs font-bold tabular-nums transition-colors",
            reward > 0 ? "text-gold" : "text-muted/50",
          )}
        >
          {reward > 0 ? `+${reward}` : "—"}
          {boosted && reward > 0 && (
            <span className="rounded bg-gold/15 px-1 text-[9px] leading-tight text-gold">
              ×{(1 + multiplierPercent / 100).toFixed(2)}
            </span>
          )}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={`Estado de: ${name}`}
        className="grid grid-cols-3 gap-1 rounded-xl border border-line/60 bg-ink-2 p-1"
      >
        {STATUS_SEQUENCE.map((s) => {
          const active = s === status;
          const meta = STATUS_META[s];
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={meta.label}
              onClick={() => handleSelect(s)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 outline-none transition-all duration-200 active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-gold/50",
                active
                  ? ACTIVE_CLASS[s]
                  : "text-muted hover:bg-surface-2/70 hover:text-fg",
              )}
            >
              <span className="text-lg leading-none">{meta.emoji}</span>
              <span className="text-[11px] font-medium leading-none">
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
