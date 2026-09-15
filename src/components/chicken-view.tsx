"use client";

import { useState } from "react";
import { Egg } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chickenStart, chickenStep, chickenCashout } from "@/actions/finances";
import { chickenMultiplier } from "@/lib/casino";
import { useWallet } from "@/lib/wallet-context";
import type { ChickenView as ChickenGame } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const LANES = 20;

export default function ChickenView() {
  const { setBalance } = useWallet();
  const [betRaw, setBetRaw] = useState("100");
  const [game, setGame] = useState<ChickenGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bet = parseAmount(betRaw);
  const playing = game?.status === "PLAYING";

  async function start() {
    if (busy || bet <= 0) return;
    setBusy(true); setMsg(null);
    const res = await chickenStart(bet);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "No se pudo iniciar"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  async function step() {
    if (busy || !playing) return;
    setBusy(true);
    const res = await chickenStep();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view);
    if (res.view.status === "DONE") setBalance(res.view.newBalance);
  }

  async function cashout() {
    if (busy || !playing || game.lane < 1) return;
    setBusy(true);
    const res = await chickenCashout();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  const lane = game?.lane ?? 0;

  return (
    <div className="mx-auto w-full max-w-md">
      {!playing && (
        <div className="mb-3 space-y-2 rounded-2xl border border-line bg-surface/70 p-4">
          <label className="block text-xs text-muted">
            Apuesta
            <input value={betRaw} onChange={(e) => setBetRaw(e.target.value)} inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
          </label>
          {game?.status === "DONE" && (
            <p className={cn("font-mono text-sm", game.result === "CASHED" ? "text-gold" : "text-danger")}>
              {game.result === "CASHED" ? `Cobraste +${game.payout} 🪙 (x${game.multiplier.toFixed(2)})` : "🚗 El pollito no lo logró — perdiste la apuesta"}
            </p>
          )}
          {msg && <p className="font-mono text-xs text-danger">{msg}</p>}
          <Button onClick={start} disabled={busy || bet <= 0} className="w-full">Jugar</Button>
        </div>
      )}

      {/* Carriles */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-ink-2 p-2">
        {Array.from({ length: LANES + 1 }, (_, i) => (
          <div key={i}
            className={cn(
              "grid h-14 min-w-11 shrink-0 place-items-center rounded-lg border text-xs font-mono",
              i === lane ? "border-gold bg-gold/15 text-gold" : "border-line bg-surface/60 text-muted",
            )}>
            {i === lane ? (game?.result === "DEAD" ? "💥" : "🐤") : i === 0 ? "🏁" : `x${chickenMultiplierLabel(i)}`}
          </div>
        ))}
      </div>

      {playing && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-muted">
            x<span className="text-gold">{game.multiplier.toFixed(2)}</span>
          </p>
          <div className="flex gap-2">
            <Button onClick={cashout} variant="surface" disabled={busy || game.lane < 1}>
              Retirar {Math.round(game.bet * game.multiplier)} 🪙
            </Button>
            <Button onClick={step} disabled={busy}>
              <Egg className="mr-1 h-4 w-4" /> Avanzar{game.nextMultiplier != null ? ` (x${game.nextMultiplier.toFixed(2)})` : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Etiqueta de multiplicador por carril para la pista (usa la math compartida).
function chickenMultiplierLabel(lane: number): string {
  return chickenMultiplier(lane).toFixed(2);
}
