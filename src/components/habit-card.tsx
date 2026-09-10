"use client";

import { useRef, useState } from "react";
import {
  STATUS_META,
  STATUS_REWARD,
  STATUS_SEQUENCE,
  computeAward,
} from "@/lib/constants";
import type { HabitStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HabitCardProps {
  name: string;
  status: HabitStatus;
  /** Monedas actualmente acreditadas por este hábito (con multiplicador). */
  reward: number;
  /** Multiplicador del bloque (suma de % de cartas equipadas). */
  multiplierPercent: number;
  /** Color de acento del bloque horario. */
  accent: string;
  /** Índice global para escalonar la animación de entrada. */
  index: number;
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
  onChange,
}: HabitCardProps) {
  const [burst, setBurst] = useState<{ id: number; amount: number } | null>(
    null,
  );
  const burstId = useRef(0);

  function handleSelect(next: HabitStatus) {
    if (next === status) return;
    // El delta espeja exactamente el cálculo del wallet: nuevo_pago - pago_actual.
    const newAward = computeAward(STATUS_REWARD[next], multiplierPercent);
    const delta = newAward - reward;
    if (delta !== 0) {
      burstId.current += 1;
      setBurst({ id: burstId.current, amount: delta });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(12);
      }
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
      {burst && (
        <span
          key={burst.id}
          onAnimationEnd={() => setBurst(null)}
          className={cn(
            "animate-coin-float pointer-events-none absolute right-4 top-2.5 z-10 flex items-center gap-0.5 font-mono text-sm font-bold",
            burst.amount > 0 ? "text-gold" : "text-danger",
          )}
        >
          {burst.amount > 0 ? "+" : "−"}
          {Math.abs(burst.amount)}
          <span className="text-[11px]">🪙</span>
        </span>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}80` }}
            aria-hidden
          />
          <h3 className="font-display text-[15px] font-semibold leading-tight text-fg">
            {name}
          </h3>
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
