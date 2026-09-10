"use client";

import {
  RARITY_META,
  TIME_BLOCK_META,
  cardArt,
  effectiveMultiplier,
} from "@/lib/constants";
import type { Card } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GameCardProps {
  card: Card;
  size?: "sm" | "lg";
  level?: number;
  className?: string;
}

export function GameCard({ card, size = "sm", level, className }: GameCardProps) {
  const rarity = RARITY_META[card.rarity];
  const block = card.target_block ? TIME_BLOCK_META[card.target_block] : null;
  const art = cardArt(card);
  const isLegendary = card.rarity === "Legendary";
  const sm = size === "sm";
  const lvl = level ?? 1;
  const mult = effectiveMultiplier(card.multiplier_percent, lvl);

  return (
    <div
      className={cn("relative h-full overflow-hidden rounded-2xl p-[2px]", className)}
      style={{ background: rarity.frame }}
    >
      {isLegendary && (
        <span
          aria-hidden
          className="animate-sheen pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)",
            backgroundSize: "250% 100%",
          }}
        />
      )}

      {lvl > 1 && (
        <span className="absolute left-1.5 top-1.5 z-20 rounded-md bg-ink/85 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-gold ring-1 ring-gold/30">
          Nv{lvl}
        </span>
      )}
      <div
        className={cn(
          "relative z-0 flex h-full flex-col items-center rounded-[14px] bg-gradient-to-b from-surface-2 to-ink-2 text-center",
          sm ? "gap-1 px-2 py-2.5" : "gap-2 px-4 py-5",
        )}
      >
        <span
          className="font-mono font-semibold uppercase tracking-[0.16em]"
          style={{ color: rarity.color, fontSize: sm ? "8px" : "10px" }}
        >
          {rarity.label}
        </span>

        <span className={cn("leading-none", sm ? "text-[28px]" : "text-6xl")}>
          {art}
        </span>

        <h3
          className={cn(
            "font-display font-bold leading-tight text-fg",
            sm ? "line-clamp-2 text-[11px]" : "text-lg",
          )}
        >
          {card.name}
        </h3>

        {!sm && (
          <span className="flex items-center gap-1.5 text-sm text-muted">
            {block ? (
              <>
                <span>{block.icon}</span>
                <span style={{ color: block.accent }}>{block.label}</span>
              </>
            ) : (
              <>🌐 Global</>
            )}
          </span>
        )}

        <span
          className={cn(
            "mt-auto rounded-full border border-gold/25 bg-gold/12 font-mono font-bold text-gold",
            sm ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-sm",
          )}
        >
          +{mult}%
        </span>

        {!sm && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
            Nivel {lvl}
          </span>
        )}
      </div>
    </div>
  );
}
