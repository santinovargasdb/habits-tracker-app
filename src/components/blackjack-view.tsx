"use client";

import { useRef, useState } from "react";
import { Spade } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bjDeal, bjHit, bjStand } from "@/actions/finances";
import { useWallet } from "@/lib/wallet-context";
import {
  cardIsRed,
  cardRankLabel,
  cardSuitSymbol,
  resultText,
} from "@/lib/blackjack";
import type { BlackjackView } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// -------------------------------------------------------------- Cartas visuales
function PlayingCard({ card, delay = 0 }: { card: number; delay?: number }) {
  const red = cardIsRed(card);
  const color = red ? "#d7263d" : "#15151d";
  return (
    <div
      className="animate-reveal-pop relative grid h-[76px] w-[54px] shrink-0 place-items-center rounded-lg border border-black/10 bg-[#f7f6f1] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.6)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="absolute left-1 top-0.5 font-display text-[11px] font-bold leading-none" style={{ color }}>
        {cardRankLabel(card)}
      </span>
      <span className="text-2xl leading-none" style={{ color }}>
        {cardSuitSymbol(card)}
      </span>
      <span className="absolute bottom-0.5 right-1 rotate-180 font-display text-[11px] font-bold leading-none" style={{ color }}>
        {cardRankLabel(card)}
      </span>
    </div>
  );
}

function FaceDownCard() {
  return (
    <div className="grid h-[76px] w-[54px] shrink-0 place-items-center rounded-lg border border-gold/25 bg-gradient-to-br from-ink-2 to-surface shadow-[0_6px_14px_-6px_rgba(0,0,0,0.6)]">
      <span className="font-display text-lg font-extrabold text-gold/60">道</span>
    </div>
  );
}

function Hand({
  label,
  score,
  cards,
  hiddenCard,
}: {
  label: string;
  score: number;
  cards: number[];
  hiddenCard?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">{label}</span>
        <span className="grid min-w-6 place-items-center rounded-md border border-line bg-ink-2 px-1.5 font-mono text-xs font-bold tabular-nums text-fg">
          {score}
          {hiddenCard ? " +?" : ""}
        </span>
      </div>
      <div className="flex gap-1.5">
        {cards.map((c, i) => (
          <PlayingCard key={`${c}-${i}`} card={c} delay={i * 70} />
        ))}
        {hiddenCard && <FaceDownCard />}
      </div>
    </div>
  );
}

export default function BlackjackView() {
  const { balance, setBalance } = useWallet();

  const [view, setView] = useState<BlackjackView | null>(null);
  const [betInput, setBetInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(null);
  const burstId = useRef(0);

  const bet = parseAmount(betInput);
  const playing = view?.status === "PLAYER_TURN";
  const done = view?.status === "DONE";
  const idle = view === null;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  function settleDelta(v: BlackjackView) {
    if (v.status !== "DONE") return;
    burstId.current += 1;
    setDelta({ id: burstId.current, amount: v.payout - v.bet });
  }

  async function deal() {
    if (busy || bet <= 0 || bet > balance) return;
    setBusy(true);
    setDelta(null);
    try {
      const res = await bjDeal(bet);
      if (!res.ok || !res.view) {
        showToast(res.insufficient ? "Saldo insuficiente." : "No se pudo repartir.");
        return;
      }
      if (res.view.newBalance !== null) setBalance(res.view.newBalance);
      setView(res.view);
      settleDelta(res.view);
    } finally {
      setBusy(false);
    }
  }

  async function hit() {
    if (busy || !playing) return;
    setBusy(true);
    try {
      const res = await bjHit();
      if (!res.ok || !res.view) {
        showToast("No se pudo pedir carta.");
        return;
      }
      if (res.view.newBalance !== null) setBalance(res.view.newBalance);
      setView(res.view);
      settleDelta(res.view);
    } finally {
      setBusy(false);
    }
  }

  async function stand() {
    if (busy || !playing) return;
    setBusy(true);
    try {
      const res = await bjStand();
      if (!res.ok || !res.view) {
        showToast("No se pudo plantar.");
        return;
      }
      if (res.view.newBalance !== null) setBalance(res.view.newBalance);
      setView(res.view);
      settleDelta(res.view);
    } finally {
      setBusy(false);
    }
  }

  function playAgain() {
    setDelta(null);
    setView(null);
  }

  const banner = done && view?.result ? resultText(view.result) : null;

  return (
    <article className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-5">
      {/* Mesa */}
      <div className="relative overflow-hidden rounded-2xl border border-met/20 bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(62,207,142,0.12),transparent_60%)] bg-ink-2 p-4">
        {delta && (
          <span
            key={delta.id}
            onAnimationEnd={() => setDelta(null)}
            className={cn(
              "animate-coin-float pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-0.5 font-mono text-base font-bold",
              delta.amount > 0 ? "text-gold" : delta.amount < 0 ? "text-danger" : "text-muted",
            )}
          >
            {delta.amount > 0 ? "+" : delta.amount < 0 ? "−" : "±"}
            {Math.abs(delta.amount).toLocaleString("es-AR")}
            <span className="text-xs">🪙</span>
          </span>
        )}

        {idle ? (
          <div className="grid place-items-center py-8 text-center">
            <Spade className="h-8 w-8 text-met" strokeWidth={2} />
            <p className="mt-2 font-display text-lg font-extrabold text-fg">Blackjack</p>
            <p className="mt-1 max-w-[15rem] text-xs text-muted">
              Apostá y repartí. Llegá a 21 sin pasarte y ganale al crupier.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Hand
              label="Crupier"
              score={view!.dealerScore}
              cards={view!.dealerCards}
              hiddenCard={view!.dealerHidden}
            />
            <div className="h-px bg-gradient-to-r from-transparent via-line to-transparent" />
            <Hand label="Vos" score={view!.playerScore} cards={view!.playerCards} />
          </div>
        )}
      </div>

      {/* Banner de resultado */}
      {banner && (
        <div
          className={cn(
            "animate-rise mt-3 rounded-xl border px-4 py-2.5 text-center font-display text-sm font-extrabold",
            banner.win
              ? "border-gold/40 bg-gold/10 text-gold"
              : banner.push
                ? "border-muted/30 bg-muted/10 text-muted"
                : "border-danger/40 bg-danger/10 text-danger",
          )}
        >
          {banner.title}
          {view!.payout > 0 && (
            <span className="ml-1 font-mono">
              {banner.push ? "· apuesta devuelta" : `· +${view!.payout.toLocaleString("es-AR")} 🪙`}
            </span>
          )}
        </div>
      )}

      {/* Controles */}
      {idle && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Apuesta"
              value={betInput}
              onChange={(e) => setBetInput(e.target.value.replace(/[^\d]/g, ""))}
              className="h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-right font-mono text-base tabular-nums text-fg outline-none placeholder:text-muted/50 focus:border-gold/50"
            />
            <Button variant="surface" size="md" disabled={balance <= 0} onClick={() => setBetInput(String(Math.min(bet + 100, balance)))}>
              +100
            </Button>
            <Button variant="surface" size="md" disabled={balance <= 0} onClick={() => setBetInput(String(balance))}>
              Max
            </Button>
          </div>
          <Button
            variant="gold"
            size="lg"
            disabled={busy || bet <= 0 || bet > balance}
            onClick={deal}
            className="mt-3 h-14 w-full text-lg"
          >
            {busy ? "Repartiendo…" : "Repartir"}
          </Button>
          <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
            {bet <= 0
              ? "Ingresá tu apuesta"
              : bet > balance
                ? "Saldo insuficiente"
                : `Apostás ${bet.toLocaleString("es-AR")} 🪙 · BJ paga 3:2`}
          </p>
        </>
      )}

      {playing && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="surface" size="lg" disabled={busy} onClick={hit} className="h-14 text-base">
            {busy ? "…" : "Pedir"}
          </Button>
          <Button variant="gold" size="lg" disabled={busy} onClick={stand} className="h-14 text-base">
            {busy ? "…" : "Plantarse"}
          </Button>
        </div>
      )}

      {done && (
        <Button variant="gold" size="lg" onClick={playAgain} className="mt-3 h-14 w-full text-lg">
          Jugar de nuevo
        </Button>
      )}

      {toast && (
        <div
          role="alert"
          className="animate-rise mt-3 rounded-xl border border-danger/40 bg-ink-2 px-4 py-2 text-center text-sm text-fg"
        >
          {toast}
        </div>
      )}
    </article>
  );
}
