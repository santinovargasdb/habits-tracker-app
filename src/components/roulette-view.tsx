"use client";

import { useEffect, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouletteWheel, WHEEL_SEG_ANGLE } from "@/components/roulette-wheel";
import { spinRoulette } from "@/actions/finances";
import { useWallet } from "@/lib/wallet-context";
import { EUROPEAN_WHEEL, ROULETTE_COLORS, rouletteColorMeta } from "@/lib/constants";
import type { RouletteColor } from "@/lib/types";
import { cn } from "@/lib/utils";

// Vueltas completas + frenado suave. La rueda gira SPIN_TURNS vueltas y encima
// suma el ángulo que alinea el número ganador con la aguja superior.
const SPIN_TURNS = 5;
const SPIN_MS = 4200;

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

interface PendingResult extends SpinOutcome {
  newBalance: number | null;
}

export default function RouletteView() {
  const { balance, setBalance } = useWallet();

  const [choice, setChoice] = useState<RouletteColor | null>(null);
  const [betInput, setBetInput] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null);
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const burstId = useRef(0);
  const pendingRef = useRef<PendingResult | null>(null);
  const restTimer = useRef<number | null>(null);

  // Limpia el timer de frenado si el componente se desmonta a mitad de giro.
  useEffect(() => {
    return () => {
      if (restTimer.current) window.clearTimeout(restTimer.current);
    };
  }, []);

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

    try {
      // El backend es la fuente de verdad (número, color, pago y balance).
      const res = await spinRoulette(bet, choice);
      if (!res.ok || res.resultNumber === null || res.resultColor === null) {
        setSpinning(false);
        showToast(res.insufficient ? "Saldo insuficiente." : "No se pudo girar.");
        return;
      }

      const number = res.resultNumber;
      const idx = EUROPEAN_WHEEL.indexOf(number);

      // Ángulo (mod 360) que deja el número ganador bajo la aguja superior.
      const targetMod = (((360 - idx * WHEEL_SEG_ANGLE) % 360) + 360) % 360;
      setRotation((prev) => {
        const currentMod = ((prev % 360) + 360) % 360;
        const forward = (((targetMod - currentMod) % 360) + 360) % 360;
        // Siempre hacia adelante: N vueltas completas + el ajuste de alineación.
        return prev + 360 * SPIN_TURNS + forward;
      });

      // Reservamos el resultado y lo aplicamos SÓLO cuando la rueda frena.
      pendingRef.current = {
        number,
        color: res.resultColor,
        won: res.won,
        net: (res.payout ?? 0) - bet,
        newBalance: res.newBalance,
      };
      if (restTimer.current) window.clearTimeout(restTimer.current);
      restTimer.current = window.setTimeout(settle, SPIN_MS + 60);
    } catch {
      setSpinning(false);
      showToast("No se pudo girar.");
    }
  }

  // Se ejecuta cuando la rueda se detiene: revela el resultado y recién ahí
  // actualiza el saldo de la wallet.
  function settle() {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;

    if (p.newBalance !== null) setBalance(p.newBalance);
    setOutcome({ number: p.number, color: p.color, won: p.won, net: p.net });
    burstId.current += 1;
    setDelta({ id: burstId.current, amount: p.net });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(p.won ? [12, 40, 12] : 40);
    }
    setSpinning(false);
  }

  function bumpBet(n: number) {
    setBetInput(String(Math.min(bet + n, balance)));
  }

  const outcomeMeta = outcome ? rouletteColorMeta(outcome.color) : null;
  const bigWin = !spinning && outcome?.won === true && outcome.color === "GREEN";

  const wheelCenter = outcome ? (
    <span
      className="font-display text-2xl font-extrabold tabular-nums"
      style={{ color: outcomeMeta?.accent }}
    >
      {outcome.number}
    </span>
  ) : (
    <span className="font-display text-xl font-bold text-muted/70">道</span>
  );

  return (
    <article className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-5">
      {/* Rueda */}
      <div className="relative flex flex-col items-center">
        {/* Glow según el resultado. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-6 h-56 w-56 rounded-full blur-3xl transition-opacity duration-500",
            outcome ? (bigWin ? "opacity-70" : outcome.won ? "opacity-50" : "opacity-20") : "opacity-15",
          )}
          style={{ backgroundColor: `${outcomeMeta?.accent ?? "#9797a6"}55` }}
        />

        <div className={cn("relative", bigWin && "animate-pulse-gold")}>
          <RouletteWheel
            rotation={rotation}
            durationMs={SPIN_MS}
            spinning={spinning}
            center={wheelCenter}
          />
        </div>

        <p
          className="relative mt-3 font-mono text-[11px] uppercase tracking-[0.22em]"
          style={{ color: outcomeMeta?.accent ?? "#9797a6" }}
        >
          {spinning
            ? "Girando…"
            : outcome
              ? `${outcomeMeta?.label} · ${outcome.won ? "¡Ganaste!" : "Perdiste"}`
              : "Elegí color y apostá"}
        </p>

        {delta && (
          <span
            key={delta.id}
            onAnimationEnd={() => setDelta(null)}
            className={cn(
              "animate-coin-float pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-0.5 font-mono text-base font-bold",
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
      <div className="mt-5 grid grid-cols-3 gap-2">
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
