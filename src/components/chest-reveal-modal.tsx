"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GameCard } from "@/components/game-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RARITY_META } from "@/lib/constants";
import type { Card } from "@/lib/types";

export type RevealPhase = "opening" | "revealed" | null;

interface ChestVisual {
  icon: string;
  accent: string;
}

interface ChestRevealModalProps {
  phase: RevealPhase;
  chest: ChestVisual | null;
  card: Card | null;
  isNew: boolean;
  quantity: number | null;
  onClose: () => void;
}

export function ChestRevealModal({
  phase,
  chest,
  card,
  isNew,
  quantity,
  onClose,
}: ChestRevealModalProps) {
  const [mounted, setMounted] = useState(false);
  // Guard de montaje en cliente para createPortal (patrón intencional).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (phase !== "revealed") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  if (!mounted || phase === null) return null;

  const rarity = card ? RARITY_META[card.rarity] : null;

  return createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center px-6">
      {/* Backdrop (sólo cierra en la fase de revelado) */}
      <button
        aria-label="Cerrar"
        onClick={phase === "revealed" ? onClose : undefined}
        tabIndex={phase === "revealed" ? 0 : -1}
        className="animate-fade-in absolute inset-0 cursor-default bg-black/75 backdrop-blur-md"
      />

      <div className="relative flex w-full max-w-xs flex-col items-center text-center">
        {phase === "opening" && chest && (
          <>
            <span
              aria-hidden
              className="animate-glow-breathe absolute h-52 w-52 rounded-full blur-2xl"
              style={{ backgroundColor: `${chest.accent}55` }}
            />
            <span className="animate-chest-shake relative text-[92px] leading-none drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
              {chest.icon}
            </span>
            <p className="relative mt-6 font-display text-lg font-bold tracking-wide text-fg">
              Abriendo…
            </p>
            <p className="relative mt-1 font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
              La suerte está echada
            </p>
          </>
        )}

        {phase === "revealed" && card && rarity && (
          <>
            {/* Halo de rareza */}
            <span
              aria-hidden
              className="animate-glow-breathe absolute -top-6 h-64 w-64 rounded-full blur-3xl"
              style={{ backgroundColor: `${rarity.color}44` }}
            />
            {/* Rayos */}
            <span
              aria-hidden
              className="animate-glow-breathe absolute top-4 h-56 w-56 rounded-full opacity-40"
              style={{
                background: `conic-gradient(from 0deg, transparent, ${rarity.color}66, transparent, ${rarity.color}66, transparent)`,
                maskImage:
                  "radial-gradient(circle, transparent 38%, black 42%, transparent 72%)",
                WebkitMaskImage:
                  "radial-gradient(circle, transparent 38%, black 42%, transparent 72%)",
              }}
            />

            <p className="relative mb-3 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              {isNew ? "¡Nueva carta!" : "Carta obtenida"}
            </p>

            <div className="animate-reveal-pop relative h-64 w-44">
              <GameCard card={card} size="lg" />
            </div>

            <div className="animate-fade-in relative mt-4 flex flex-col items-center gap-2">
              {isNew ? (
                <Badge variant="gold" size="md">
                  ✦ Primera vez en tu colección
                </Badge>
              ) : (
                <Badge variant="default" size="md">
                  Repetida · ahora ×{quantity ?? 2}
                </Badge>
              )}
              <Button
                variant="gold"
                size="lg"
                className="mt-2 w-full"
                onClick={onClose}
                autoFocus
              >
                Genial
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
