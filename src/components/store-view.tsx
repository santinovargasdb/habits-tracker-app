"use client";

import { useState } from "react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChestRevealModal,
  type RevealPhase,
} from "@/components/chest-reveal-modal";
import { openChest } from "@/actions/gacha";
import { useWallet } from "@/lib/wallet-context";
import { useGame } from "@/lib/game-context";
import {
  CHESTS,
  GACHA_WEIGHTS,
  RARITY_META,
  RARITY_SEQUENCE,
  type ChestConfig,
} from "@/lib/constants";
import type { Card } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RevealState {
  phase: RevealPhase;
  chest: ChestConfig | null;
  card: Card | null;
  isNew: boolean;
  quantity: number | null;
}

const CLOSED: RevealState = {
  phase: null,
  chest: null,
  card: null,
  isNew: false,
  quantity: null,
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function StoreView() {
  const { balance, setBalance } = useWallet();
  const { cardById, applyCardWin } = useGame();

  const [reveal, setReveal] = useState<RevealState>(CLOSED);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function handleBuy(chest: ChestConfig) {
    if (busy || balance < chest.cost) return;
    setBusy(true);
    setReveal({ ...CLOSED, phase: "opening", chest });

    try {
      const [res] = await Promise.all([openChest(chest.cost), wait(1300)]);
      if (!res.ok || !res.card) {
        setReveal(CLOSED);
        showToast(
          res.insufficient
            ? "Saldo insuficiente."
            : "No se pudo abrir el cofre. Reintentá.",
        );
        return;
      }

      // Actualizamos la billetera con el balance autoritativo del servidor.
      if (res.newBalance !== null) setBalance(res.newBalance);
      applyCardWin(res.card.id, res.quantity ?? undefined);

      // Carta a revelar: completamos con el catálogo del contexto y forzamos el
      // icono devuelto por la acción (robusto ante icon_url/image_url).
      const ctx = cardById(res.card.id);
      const won: Card = ctx
        ? { ...ctx, image_url: res.card.image_url ?? ctx.image_url }
        : {
            id: res.card.id,
            name: res.card.name,
            rarity: res.card.rarity,
            target_block: null,
            multiplier_percent: 0,
            description: "",
            image_url: res.card.image_url,
          };

      setReveal({
        phase: "revealed",
        chest,
        card: won,
        isNew: res.isNew,
        quantity: res.quantity,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <section className="animate-rise mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
          Mercado
        </p>
        <h1 className="mt-1 font-display text-[26px] font-extrabold tracking-tight text-fg">
          Tienda de Cofres
        </h1>
        <p className="mt-1 text-sm text-muted">
          Gastá tus monedas y expandí tu colección.
        </p>
      </section>

      <div className="space-y-4">
        {CHESTS.map((chest, i) => {
          const affordable = balance >= chest.cost;
          const shortfall = chest.cost - balance;
          return (
            <article
              key={chest.type}
              className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-4"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              {/* Halo del cofre */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
                style={{ backgroundColor: `${chest.accent}22` }}
              />

              <div className="relative flex items-start gap-3.5">
                <div
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border text-4xl"
                  style={{
                    borderColor: `${chest.accent}55`,
                    background: `radial-gradient(circle at 50% 40%, ${chest.accent}33, transparent 70%)`,
                  }}
                >
                  {chest.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <h2
                    className="font-display text-lg font-extrabold leading-tight"
                    style={{ color: chest.accent }}
                  >
                    {chest.name}
                  </h2>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">
                    {chest.blurb}
                  </p>
                </div>
              </div>

              {/* Probabilidades (odds reales del gacha; iguales para todo cofre) */}
              <div className="relative mt-3 flex flex-wrap gap-1.5">
                {RARITY_SEQUENCE.map((r) => {
                  const meta = RARITY_META[r];
                  return (
                    <Badge
                      key={r}
                      variant="outline"
                      style={{
                        color: meta.color,
                        borderColor: `${meta.color}44`,
                        backgroundColor: `${meta.color}12`,
                      }}
                    >
                      {meta.label} {Math.round(GACHA_WEIGHTS[r] * 100)}%
                    </Badge>
                  );
                })}
              </div>

              {/* Precio + acción */}
              <div className="relative mt-4 flex items-center justify-between gap-3">
                <Badge variant="gold" size="md" className="text-sm">
                  <Coins className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {chest.cost.toLocaleString("es-AR")}
                </Badge>

                <Button
                  variant="gold"
                  size="md"
                  disabled={!affordable || busy}
                  onClick={() => handleBuy(chest)}
                  className={cn(!affordable && "grayscale")}
                >
                  {affordable
                    ? "Abrir cofre"
                    : `Faltan ${shortfall.toLocaleString("es-AR")} 🪙`}
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      {toast && (
        <div
          role="alert"
          className="animate-rise fixed inset-x-0 bottom-24 z-[70] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-danger/40 bg-surface px-4 py-3 text-center text-sm text-fg shadow-2xl"
        >
          {toast}
        </div>
      )}

      <ChestRevealModal
        phase={reveal.phase}
        chest={reveal.chest}
        card={reveal.card}
        isNew={reveal.isNew}
        quantity={reveal.quantity}
        onClose={() => setReveal(CLOSED)}
      />
    </div>
  );
}
