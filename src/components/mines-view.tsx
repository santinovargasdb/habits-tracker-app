"use client";

import { useState } from "react";
import { Bomb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { minesStart, minesPick, minesCashout } from "@/actions/finances";
import { minesMultiplier } from "@/lib/casino";
import { useWallet } from "@/lib/wallet-context";
import type { MinesView as MinesGame } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function parseMines(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Math.min(24, Math.max(1, Number.isFinite(n) ? n : 1));
}

export default function MinesView() {
  const { setBalance } = useWallet();
  const [betRaw, setBetRaw] = useState("100");
  const [minesRaw, setMinesRaw] = useState("3");
  const [game, setGame] = useState<MinesGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bet = parseAmount(betRaw);
  const mines = parseMines(minesRaw);
  const playing = game?.status === "PLAYING";

  async function start() {
    if (busy || bet <= 0) return;
    setBusy(true); setMsg(null);
    const res = await minesStart(bet, mines);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "No se pudo iniciar"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  async function pick(cell: number) {
    if (busy || !playing || game.picks.includes(cell)) return;
    setBusy(true);
    const res = await minesPick(cell);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view);
    if (res.view.status === "DONE") setBalance(res.view.newBalance);
  }

  async function cashout() {
    if (busy || !playing || game.picks.length < 1) return;
    setBusy(true);
    const res = await minesCashout();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  const revealed = new Set(game?.picks ?? []);
  const mineSet = new Set(game?.revealedMines ?? []);

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Controles previos / resultado */}
      {!playing && (
        <div className="mb-3 space-y-2 rounded-2xl border border-line bg-surface/70 p-4">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-muted">
              Apuesta
              <input value={betRaw} onChange={(e) => setBetRaw(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
            </label>
            <label className="w-24 text-xs text-muted">
              Minas (1–24)
              <input value={minesRaw} onChange={(e) => setMinesRaw(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
            </label>
          </div>
          <p className="font-mono text-[11px] text-muted">
            Primera casilla paga <span className="text-gold">x{minesMultiplier(mines, 1).toFixed(2)}</span>
          </p>
          {game?.status === "DONE" && (
            <p className={cn("font-mono text-sm", game.result === "CASHED" ? "text-gold" : "text-danger")}>
              {game.result === "CASHED" ? `Cobraste +${game.payout} 🪙` : "💥 Tocaste una mina — perdiste la apuesta"}
            </p>
          )}
          {msg && <p className="font-mono text-xs text-danger">{msg}</p>}
          <Button onClick={start} disabled={busy || bet <= 0} className="w-full">Jugar</Button>
        </div>
      )}

      {/* Grid 5x5 */}
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 25 }, (_, i) => {
          const isRevealed = revealed.has(i);
          const isMine = (game?.status === "DONE") && mineSet.has(i);
          return (
            <button key={i} type="button" onClick={() => pick(i)}
              disabled={!playing || busy || isRevealed}
              className={cn(
                "aspect-square rounded-lg border text-lg grid place-items-center transition",
                isMine ? "border-danger/60 bg-danger/15"
                  : isRevealed ? "border-gold/50 bg-gold/12 text-gold"
                  : "border-line bg-ink-2 hover:bg-surface",
              )}>
              {isMine ? "💣" : isRevealed ? "✦" : ""}
            </button>
          );
        })}
      </div>

      {/* Cash out */}
      {playing && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-muted">
            x<span className="text-gold">{game.multiplier.toFixed(2)}</span>
            {game.nextMultiplier != null && <span className="text-muted"> · próx. x{game.nextMultiplier.toFixed(2)}</span>}
          </p>
          <Button onClick={cashout} disabled={busy || game.picks.length < 1}>
            <Bomb className="mr-1 h-4 w-4" /> Retirar {Math.round(game.bet * game.multiplier)} 🪙
          </Button>
        </div>
      )}
    </div>
  );
}
