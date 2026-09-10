"use client";

import { useState } from "react";
import {
  RARITY_FRAME_CLASS,
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
  // Registramos la URL que falló (no un boolean) para que, al reutilizar la
  // instancia con otra carta, el <img> se reintente sin efectos ni setState-in-effect.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  const rarity = RARITY_META[card.rarity];
  const block = card.target_block ? TIME_BLOCK_META[card.target_block] : null;
  const art = cardArt(card);
  const isLegendary = card.rarity === "Legendary";
  const sm = size === "sm";
  const lvl = level ?? 1;
  const mult = effectiveMultiplier(card.multiplier_percent, lvl);
  const showImg = Boolean(card.image_url) && erroredSrc !== card.image_url;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col items-center overflow-hidden rounded-2xl border-2 text-center",
        RARITY_FRAME_CLASS[card.rarity],
        sm ? "gap-1 px-2 py-2.5" : "gap-1.5 px-3 py-4",
        className,
      )}
    >
      {/* Brillo diagonal continuo — refuerza la sensación "legendaria". */}
      {isLegendary && (
        <span
          aria-hidden
          className="animate-sheen pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.5) 50%, transparent 65%)",
            backgroundSize: "250% 100%",
          }}
        />
      )}

      {/* Nivel (solo si subió de 1). */}
      {lvl > 1 && (
        <span className="absolute left-1.5 top-1.5 z-20 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-yellow-300 ring-1 ring-yellow-400/40">
          Nv{lvl}
        </span>
      )}

      <span
        className="relative z-0 font-mono font-semibold uppercase tracking-[0.16em]"
        style={{ color: rarity.color, fontSize: sm ? "8px" : "10px" }}
      >
        {rarity.label}
      </span>

      {/* Icono oficial (image_url) con fallback a emoji. */}
      <div
        className={cn(
          "relative z-0 grid place-items-center",
          sm ? "h-12 w-12" : "h-20 w-20",
        )}
      >
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element -- icono estático del catálogo; <img> es intencional y liviano
          <img
            src={card.image_url as string}
            alt={card.name}
            onError={() => setErroredSrc(card.image_url)}
            draggable={false}
            loading="lazy"
            className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
          />
        ) : (
          <span
            aria-hidden
            className={cn("leading-none", sm ? "text-[30px]" : "text-6xl")}
          >
            {art}
          </span>
        )}
      </div>

      <h3
        className={cn(
          "relative z-0 font-display font-bold leading-tight text-white",
          sm ? "line-clamp-2 text-[11px]" : "text-lg",
        )}
      >
        {card.name}
      </h3>

      {/* Bloque al que pertenece (o global). */}
      <span
        className={cn(
          "relative z-0 flex max-w-full items-center gap-1 font-medium",
          sm ? "text-[9px]" : "text-[13px]",
        )}
        style={{ color: block ? block.accent : undefined }}
      >
        {block ? (
          <>
            <span aria-hidden>{block.icon}</span>
            <span className="truncate">{block.label}</span>
          </>
        ) : (
          <span className="text-slate-300">🌐 Global</span>
        )}
      </span>

      {/* Multiplicador activo. */}
      <span
        className={cn(
          "relative z-0 mt-auto rounded-full border border-yellow-400/30 bg-yellow-400/10 font-mono font-bold text-yellow-300",
          sm ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-sm",
        )}
      >
        +{mult}%
      </span>

      {!sm && (
        <span className="relative z-0 font-mono text-[11px] uppercase tracking-wider text-slate-400">
          Nivel {lvl}
        </span>
      )}
    </div>
  );
}
