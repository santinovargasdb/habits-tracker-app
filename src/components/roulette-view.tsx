"use client";

import { useRef, useState } from "react";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spinRoulette } from "@/actions/finances";
import { useWallet } from "@/lib/wallet-context";
import {
  ROULETTE_COLORS,
  rouletteColor,
  rouletteColorMeta,
} from "@/lib/constants";
import type { RouletteColor } from "@/lib/types";
import { cn } from "@/lib/utils";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface SpinOutcome {
  number: number;
  color: RouletteColor;
  won: boolean;
  net: number;
}

export default function RouletteView() {
  const { balance, setBalance } = useWallet();

  const [choice, setChoice] = useState<RouletteColor | null>(null);
  const [betInput, setBetInput] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null);
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const burstId = useRef(0);

  const bet = parseAmount(betInput);
  const canSpin = !spinning && choice !== null && bet > 0 && bet <= balance;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function spin() {
    if (!canSpin || choice === null) return;
    setSpinning(true);
    setOutcome(null);
    setDelta(null);

    // Ciclado visual de números.
    const iv = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 37));
    }, 80);

    try {
      const [res] = await Promise.all([spinRoulette(bet, choice), wait(1900)]);
      clearInterval(iv);
      if (!res.ok || res.resultNumber === null || res.resultColor === null) {
        setDisplayNum(null);
        showToast(res.insufficient ? "Saldo insuficiente." : "No se pudo girar.");
        return;
      }
      const number = res.resultNumber;
      const color = res.resultColor;
      const won = res.won;
      const net = (res.payout ?? 0) - bet;
      if (res.newBalance !== null) setBalance(res.newBalance);

      setDisplayNum(number);
      setOutcome({ number, color, won, net });
      burstId.current += 1;
      setDelta({ id: burstId.current, amount: net });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(won ? [12, 40, 12] : 40);
      }
    } finally {
      setSpinning(false);
    }
  }

  const shownColor = displayNum !== null ? rouletteColor(displayNum) : null;
  const shownMeta = shownColor ? rouletteColorMeta(shownColor) : null;
  const bigWin = !spinning && outcome?.won && outcome.color === "GREEN";

  function bumpBet(n: number) {
    setBetInput(String(Math.min(bet + n, balance)));
  }

  return (
    <article className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-5">
      {/* Display del giro */}
      <div className="relative grid h-40 place-items-center overflow-hidden rounded-2xl border border-line bg-ink-2">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute h-44 w-44 rounded-full blur-3xl transition-opacity",
            bigWin ? "opacity-70" : "opacity-25",
          )}
          style={{ backgroundColor: `${shownMeta?.accent ?? "#9797a6"}55` }}
        />
        <div className={cn("relative flex flex-col items-center", bigWin && "animate-pulse-gold")}>
          <span
            className={cn(
              "grid h-24 w-24 place-items-center rounded-2xl font-display font-extrabold leading-none tabular-nums shadow-lg transition-all",
              spinning ? "text-5xl" : "text-6xl",
            )}
            style={{
              backgroundColor: shownMeta?.swatch ?? "#16161f",
              color: shownMeta?.ink ?? "#ededf2",
              boxShadow: `0 12px 34px -12px ${shownMeta?.accent ?? "#000"}aa`,
            }}
          >
            {displayNum ?? "–"}
          </span>
          <span
            className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em]"
            style={{ color: shownMeta?.accent ?? "#9797a6" }}
          >
            {spinning
              ? "Girando…"
              : outcome
                ? `${shownMeta?.label} · ${outcome.won ? "¡Ganaste!" : "Perdiste"}`
                : "Elegí color y apostá"}
          </span>
        </div>

        {delta && (
          <span
            key={delta.id}
            onAnimationEnd={() => setDelta(null)}
            className={cn(
              "animate-coin-float pointer-events-none absolute right-5 top-4 z-10 flex items-center gap-0.5 font-mono text-base font-bold",
              delta.amount > 0 ? "text-gold" : delta.amount < 0 ? "text-danger" : "text-muted",
            )}
          >
            {delta.amount > 0 ? "+" : delta.amount < 0 ? "−" : "±"}
            {Math.abs(delta.amount).toLocaleString("es-AR")}
            <span className="text-xs">🪙</span>
          </span>
        )}
      </div>

      {/* Selección de color */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {ROULETTE_COLORS.map((c) => {
          const active = choice === c.key;
          return (
            <button
              key={c.key}
              type="button"
              disabled={spinning}
              onClick={() => setChoice(c.key)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 transition active:scale-[0.98] disabled:opacity-50",
                active ? "ring-2 ring-offset-2 ring-offset-surface" : "opacity-90 hover:opacity-100",
              )}
              style={{
                backgroundColor: c.swatch,
                color: c.ink,
                borderColor: active ? c.accent : "transparent",
                ...(active
                  ? ({ "--tw-ring-color": c.accent } as React.CSSProperties)
                  : {}),
              }}
            >
              <span className="font-display text-sm font-extrabold">{c.label}</span>
              <span className="font-mono text-[11px] opacity-90">×{c.multiplier}</span>
              <span className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                {c.slots} {c.slots === 1 ? "casilla" : "casillas"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Apuesta */}
      <div className="mt-4 flex items-center gap-2">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Apuesta"
          value={betInput}
          disabled={spinning}
          onChange={(e) => setBetInput(e.target.value.replace(/[^\d]/g, ""))}
          className="h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-right font-mono text-base tabular-nums text-fg outline-none placeholder:text-muted/50 focus:border-gold/50 disabled:opacity-50"
        />
        <Button variant="surface" size="md" disabled={spinning || balance <= 0} onClick={() => bumpBet(100)}>
          +100
        </Button>
        <Button variant="surface" size="md" disabled={spinning || balance <= 0} onClick={() => setBetInput(String(balance))}>
          Max
        </Button>
      </div>

      <Button
        variant="gold"
        size="lg"
        disabled={!canSpin}
        onClick={spin}
        className="mt-3 h-14 w-full text-lg"
      >
        <Dices className="h-5 w-5" strokeWidth={2.5} />
        {spinning ? "Girando…" : "GIRAR"}
      </Button>
      <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
        {choice === null
          ? "Elegí un color"
          : bet <= 0
            ? "Ingresá tu apuesta"
            : bet > balance
              ? "Saldo insuficiente"
              : `${rouletteColorMeta(choice).label} · ${bet.toLocaleString("es-AR")} 🪙`}
      </p>

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
