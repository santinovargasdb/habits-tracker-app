"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import HabitCard from "@/components/habit-card";
import { setHabitStatus } from "@/actions/habits";
import { useWallet } from "@/lib/wallet-context";
import { useGame } from "@/lib/game-context";
import {
  STATUS_REWARD,
  TIME_BLOCK_META,
  TIME_BLOCK_ORDER,
  computeAward,
} from "@/lib/constants";
import type { AwardMap, Habit, HabitStatus, LogMap } from "@/lib/types";
import { cn, formatLongDate } from "@/lib/utils";

interface TrackerViewProps {
  date: string;
  habits: Habit[];
  initialLogs: LogMap;
  initialAwards: AwardMap;
  configured: boolean;
}

export default function TrackerView({
  date,
  habits,
  initialLogs,
  initialAwards,
  configured,
}: TrackerViewProps) {
  const { setBalance, addToBalance } = useWallet();
  const { multiplierForBlock } = useGame();
  const [logs, setLogs] = useState<LogMap>(initialLogs);
  const [awards, setAwards] = useState<AwardMap>(initialAwards);
  const [toast, setToast] = useState<string | null>(null);

  // Resumen del día (usa el pago real acreditado, con multiplicador).
  const { done, total, earnedToday } = useMemo(() => {
    let done = 0;
    let earnedToday = 0;
    for (const h of habits) {
      const s = logs[h.id] ?? "NONE";
      if (s !== "NONE") done += 1;
      earnedToday += awards[h.id] ?? 0;
    }
    return { done, total: habits.length, earnedToday };
  }, [habits, logs, awards]);

  const grouped = useMemo(
    () =>
      TIME_BLOCK_ORDER.map((block) => ({
        block,
        items: habits.filter((h) => h.time_block === block),
      })).filter((g) => g.items.length > 0),
    [habits],
  );

  function handleChange(habit: Habit, next: HabitStatus) {
    const prevStatus = logs[habit.id] ?? "NONE";
    if (next === prevStatus) return;

    const mult = multiplierForBlock(habit.time_block);
    const prevAward = awards[habit.id] ?? 0;
    const newAward = computeAward(STATUS_REWARD[next], mult);
    const delta = newAward - prevAward;

    // 1) Optimista.
    setLogs((m) => ({ ...m, [habit.id]: next }));
    setAwards((m) => ({ ...m, [habit.id]: newAward }));
    addToBalance(delta);

    // 2) Persistencia + reconciliación.
    void (async () => {
      const res = await setHabitStatus(habit.id, date, next);

      if (configured && !res.persisted) {
        setLogs((m) => ({ ...m, [habit.id]: prevStatus }));
        setAwards((m) => ({ ...m, [habit.id]: prevAward }));
        addToBalance(-delta);
        setToast("No se pudo guardar. Revisá tu conexión / Supabase.");
        window.setTimeout(() => setToast(null), 3200);
        return;
      }

      if (res.persisted) {
        if (res.balance !== null) setBalance(res.balance);
        if (res.coinsAwarded !== null) {
          setAwards((m) => ({ ...m, [habit.id]: res.coinsAwarded as number }));
        }
      }
    })();
  }

  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      {/* Hero */}
      <section className="animate-rise mb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
          Hoy · {date}
        </p>
        <h1 className="mt-1 font-display text-[26px] font-extrabold capitalize leading-tight tracking-tight text-fg">
          {formatLongDate(date)}
        </h1>

        <div className="mt-4 rounded-2xl border border-line bg-surface/70 p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Progreso del día
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-fg">
                {done}
                <span className="text-muted">/{total}</span>
                <span className="ml-1 text-sm font-medium text-muted">
                  hábitos
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Ganado hoy
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gold">
                +{earnedToday.toLocaleString("es-AR")}
                <span className="ml-0.5 text-sm">🪙</span>
              </p>
            </div>
          </div>

          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold to-fire transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {!configured && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2.5">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-gold"
              strokeWidth={2.2}
            />
            <p className="text-[12px] leading-snug text-muted">
              <span className="font-semibold text-fg">Modo demo.</span> Los
              cambios no se guardan todavía. Completá{" "}
              <code className="rounded bg-ink-2 px-1 py-0.5 font-mono text-[11px] text-gold">
                .env.local
              </code>{" "}
              con tus claves de Supabase para persistir.
            </p>
          </div>
        )}
      </section>

      {/* Bloques horarios */}
      <div className="space-y-7">
        {grouped.map(({ block, items }, gi) => {
          const meta = TIME_BLOCK_META[block];
          const mult = multiplierForBlock(block);
          return (
            <section key={block}>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="text-lg" aria-hidden>
                  {meta.icon}
                </span>
                <h2
                  className="font-display text-xs font-bold uppercase tracking-[0.2em]"
                  style={{ color: meta.accent }}
                >
                  {meta.label}
                </h2>
                {mult > 0 && (
                  <span className="flex items-center gap-1 rounded-full border border-gold/30 bg-gold/12 px-2 py-0.5 font-mono text-[10px] font-bold text-gold">
                    ×{(1 + mult / 100).toFixed(2)}
                  </span>
                )}
                <span
                  className="h-px flex-1"
                  style={{
                    background: `linear-gradient(to right, ${meta.accent}55, transparent)`,
                  }}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {meta.window}
                </span>
              </div>

              <div className="space-y-2.5">
                {items.map((habit, i) => (
                  <HabitCard
                    key={habit.id}
                    name={habit.name}
                    status={logs[habit.id] ?? "NONE"}
                    reward={awards[habit.id] ?? 0}
                    multiplierPercent={mult}
                    accent={meta.accent}
                    index={gi * 2 + i}
                    onChange={(next) => handleChange(habit, next)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="alert"
          className={cn(
            "animate-rise fixed inset-x-0 bottom-24 z-[70] mx-auto w-[calc(100%-2rem)] max-w-sm",
            "rounded-xl border border-danger/40 bg-surface px-4 py-3 text-center text-sm text-fg shadow-2xl",
          )}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
