"use client";

import { useEffect, useRef, useState } from "react";
import { Dices, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  calculateDailyInterest,
  manageInvestment,
  spinRoulette,
} from "@/actions/finances";
import { useWallet } from "@/lib/wallet-context";
import {
  FUND_META,
  FUND_ORDER,
  ROULETTE_CYCLE,
  ROULETTE_TABLE,
  rollRouletteMultiplier,
  rouletteSegment,
  type RouletteTone,
} from "@/lib/constants";
import type { FundType, Investment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FinancesViewProps {
  initialInvestments: Investment[];
  configured: boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const TONE_COLOR: Record<RouletteTone, string> = {
  lose: "#ff6b6b",
  neutral: "#9797a6",
  win: "#f6c445",
  jackpot: "#f6c445",
};

export default function FinancesView({
  initialInvestments,
  configured,
}: FinancesViewProps) {
  const { balance, setBalance, addToBalance } = useWallet();

  // -------------------------------------------------------------- Inversión
  const [amounts, setAmounts] = useState<Record<FundType, number>>(() => {
    const m: Record<FundType, number> = { CONSERVATIVE: 0, AGGRESSIVE: 0 };
    for (const inv of initialInvestments) m[inv.fund_type] = inv.invested_amount;
    return m;
  });
  const [inputs, setInputs] = useState<Record<FundType, string>>({
    CONSERVATIVE: "",
    AGGRESSIVE: "",
  });
  const [busyFund, setBusyFund] = useState<FundType | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }

  // Interés diario: silencioso al montar.
  useEffect(() => {
    if (!configured) return;
    let active = true;
    calculateDailyInterest().then((res) => {
      if (active && res.persisted && res.funds) {
        setAmounts((prev) => {
          const next = { ...prev };
          for (const f of res.funds!) next[f.fund_type] = f.invested_amount;
          return next;
        });
      }
    });
    return () => {
      active = false;
    };
  }, [configured]);

  async function move(fund: FundType, action: "DEPOSIT" | "WITHDRAW") {
    if (busyFund) return;
    const amount = parseAmount(inputs[fund]);
    if (!amount) return;
    if (action === "DEPOSIT" && amount > balance) {
      showToast("No te alcanza el saldo.");
      return;
    }
    if (action === "WITHDRAW" && amount > amounts[fund]) {
      showToast("No tenés tanto invertido.");
      return;
    }

    setBusyFund(fund);
    const walletDelta = action === "DEPOSIT" ? -amount : amount;
    const fundDelta = action === "DEPOSIT" ? amount : -amount;

    // Optimista
    addToBalance(walletDelta);
    setAmounts((a) => ({ ...a, [fund]: a[fund] + fundDelta }));
    setInputs((i) => ({ ...i, [fund]: "" }));

    try {
      const res = await manageInvestment(action, fund, amount);
      if (configured && !res.ok) {
        addToBalance(-walletDelta);
        setAmounts((a) => ({ ...a, [fund]: a[fund] - fundDelta }));
        showToast(res.insufficient ? "Saldo insuficiente." : "No se pudo procesar.");
        return;
      }
      if (res.ok) {
        if (res.newBalance !== null) setBalance(res.newBalance);
        if (res.newInvested !== null)
          setAmounts((a) => ({ ...a, [fund]: res.newInvested as number }));
      }
    } finally {
      setBusyFund(null);
    }
  }

  // ----------------------------------------------------------------- Ruleta
  const [betInput, setBetInput] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState<number | null>(null);
  const [result, setResult] = useState<{ multiplier: number; net: number } | null>(
    null,
  );
  const [delta, setDelta] = useState<{ id: number; amount: number } | null>(null);
  const burstId = useRef(0);

  const bet = parseAmount(betInput);
  const betValid = bet > 0 && bet <= balance && !spinning;

  function bumpBet(n: number) {
    setBetInput(String(Math.min(bet + n, balance)));
  }

  async function spin() {
    if (spinning || bet <= 0 || bet > balance) return;
    setSpinning(true);
    setResult(null);
    setDelta(null);

    let i = 0;
    const iv = setInterval(() => {
      setDisplay(ROULETTE_CYCLE[i % ROULETTE_CYCLE.length]);
      i += 1;
    }, 90);

    try {
      let mult: number;
      let payout: number;

      if (configured) {
        const [res] = await Promise.all([spinRoulette(bet), wait(1900)]);
        clearInterval(iv);
        if (!res.ok || res.multiplier === null) {
          setDisplay(null);
          showToast(res.insufficient ? "Saldo insuficiente." : "No se pudo girar.");
          return;
        }
        mult = res.multiplier;
        payout = res.payout ?? bet * mult;
        if (res.newBalance !== null) setBalance(res.newBalance);
      } else {
        mult = rollRouletteMultiplier();
        payout = bet * mult;
        await wait(1900);
        clearInterval(iv);
        addToBalance(payout - bet);
      }

      setDisplay(mult);
      const net = payout - bet;
      setResult({ multiplier: mult, net });
      burstId.current += 1;
      setDelta({ id: burstId.current, amount: net });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(mult === 0 ? 40 : [12, 40, 12]);
      }
    } finally {
      setSpinning(false);
    }
  }

  const shown = display;
  const shownSeg = shown !== null ? rouletteSegment(shown) : null;
  const displayColor = spinning
    ? "#ededf2"
    : shownSeg
      ? TONE_COLOR[shownSeg.tone]
      : "#9797a6";
  const isJackpot = !spinning && result?.multiplier === 50;

  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <section className="animate-rise mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
          Finanzas
        </p>
        <h1 className="mt-1 font-display text-[26px] font-extrabold tracking-tight text-fg">
          Mercado Financiero
        </h1>
        <p className="mt-1 text-sm text-muted">
          Hacé crecer tus monedas… o arriesgalas todo.
        </p>
      </section>

      {/* ------------------------------------------------------- INVERSIÓN */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4 text-met" strokeWidth={2.4} />
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-fg">
            Inversión
          </h2>
          <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
        </div>

        <div className="space-y-3">
          {FUND_ORDER.map((fund, idx) => {
            const cfg = FUND_META[fund];
            const invested = amounts[fund];
            const amount = parseAmount(inputs[fund]);
            const busy = busyFund === fund;
            return (
              <article
                key={fund}
                className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-4"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl"
                  style={{ backgroundColor: `${cfg.accent}1f` }}
                />
                <div className="relative flex items-start gap-3">
                  <div
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border text-2xl"
                    style={{
                      borderColor: `${cfg.accent}55`,
                      background: `radial-gradient(circle at 50% 40%, ${cfg.accent}2e, transparent 70%)`,
                    }}
                  >
                    {cfg.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3
                        className="font-display text-base font-extrabold leading-tight"
                        style={{ color: cfg.accent }}
                      >
                        {cfg.name}
                      </h3>
                      <Badge variant="outline" className="shrink-0">
                        {cfg.short}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
                      {cfg.rate}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      Invertido
                    </p>
                    <p
                      className="font-mono text-lg font-bold tabular-nums"
                      style={{ color: cfg.accent }}
                    >
                      {invested.toLocaleString("es-AR")}
                    </p>
                  </div>
                </div>

                <div className="relative mt-3 flex items-center gap-2">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    value={inputs[fund]}
                    onChange={(e) =>
                      setInputs((i) => ({
                        ...i,
                        [fund]: e.target.value.replace(/[^\d]/g, ""),
                      }))
                    }
                    className="h-10 w-full rounded-xl border border-line bg-ink-2 px-3 text-right font-mono text-sm tabular-nums text-fg outline-none placeholder:text-muted/50 focus:border-gold/50"
                  />
                  <Button
                    variant="gold"
                    size="sm"
                    disabled={busy || amount <= 0 || amount > balance}
                    onClick={() => move(fund, "DEPOSIT")}
                  >
                    Depositar
                  </Button>
                  <Button
                    variant="surface"
                    size="sm"
                    disabled={busy || amount <= 0 || amount > invested}
                    onClick={() => move(fund, "WITHDRAW")}
                  >
                    Retirar
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------- CASINO */}
      <section>
        <div className="mb-3 flex items-center gap-2.5">
          <Dices className="h-4 w-4 text-gold" strokeWidth={2.4} />
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-fg">
            Casino
          </h2>
          <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
        </div>

        <article className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-5">
          {/* Leyenda de probabilidades */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {ROULETTE_TABLE.map((seg) => (
              <Badge
                key={seg.multiplier}
                variant="outline"
                style={{
                  color: TONE_COLOR[seg.tone],
                  borderColor: `${TONE_COLOR[seg.tone]}44`,
                }}
              >
                ×{seg.multiplier} · {seg.weight}%
              </Badge>
            ))}
          </div>

          {/* Display del giro */}
          <div className="relative mt-5 grid h-36 place-items-center overflow-hidden rounded-2xl border border-line bg-ink-2">
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute h-40 w-40 rounded-full blur-3xl transition-opacity",
                isJackpot ? "opacity-70" : "opacity-25",
              )}
              style={{ backgroundColor: `${displayColor}55` }}
            />
            <div
              className={cn(
                "relative flex flex-col items-center",
                isJackpot && "animate-pulse-gold",
              )}
            >
              <span
                className={cn(
                  "font-display font-extrabold leading-none tabular-nums transition-colors",
                  spinning ? "text-6xl opacity-90" : "text-7xl",
                )}
                style={{ color: displayColor }}
              >
                ×{shown ?? 0}
              </span>
              <span
                className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em]"
                style={{ color: displayColor }}
              >
                {spinning
                  ? "Girando…"
                  : shownSeg
                    ? shownSeg.label
                    : "Probá tu suerte"}
              </span>
            </div>

            {delta && (
              <span
                key={delta.id}
                onAnimationEnd={() => setDelta(null)}
                className={cn(
                  "animate-coin-float pointer-events-none absolute right-5 top-4 z-10 flex items-center gap-0.5 font-mono text-base font-bold",
                  delta.amount > 0
                    ? "text-gold"
                    : delta.amount < 0
                      ? "text-danger"
                      : "text-muted",
                )}
              >
                {delta.amount > 0 ? "+" : delta.amount < 0 ? "−" : "±"}
                {Math.abs(delta.amount).toLocaleString("es-AR")}
                <span className="text-xs">🪙</span>
              </span>
            )}
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
            <Button
              variant="surface"
              size="md"
              disabled={spinning || balance <= 0}
              onClick={() => bumpBet(100)}
            >
              +100
            </Button>
            <Button
              variant="surface"
              size="md"
              disabled={spinning || balance <= 0}
              onClick={() => setBetInput(String(balance))}
            >
              Max
            </Button>
          </div>

          <Button
            variant="gold"
            size="lg"
            disabled={!betValid}
            onClick={spin}
            className="mt-3 h-14 w-full text-lg"
          >
            <Dices className="h-5 w-5" strokeWidth={2.5} />
            {spinning ? "Girando…" : "GIRAR"}
          </Button>
          <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
            {bet > balance
              ? "Saldo insuficiente"
              : bet > 0
                ? `Apostás ${bet.toLocaleString("es-AR")} 🪙`
                : "Ingresá tu apuesta"}
          </p>
        </article>
      </section>

      {toast && (
        <div
          role="alert"
          className="animate-rise fixed inset-x-0 bottom-24 z-[70] mx-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-danger/40 bg-surface px-4 py-3 text-center text-sm text-fg shadow-2xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
