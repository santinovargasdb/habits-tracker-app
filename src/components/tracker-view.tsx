"use client";

import { useMemo, useRef, useState } from "react";
import HabitCard from "@/components/habit-card";
import { setHabitStatus } from "@/actions/habits";
import { useWallet } from "@/lib/wallet-context";
import { useGame } from "@/lib/game-context";
import {
  TIME_BLOCK_META,
  TIME_BLOCK_ORDER,
  WEEKLY_BLOCK_META,
} from "@/lib/constants";
import type { AwardMap, Habit, HabitStatus, LogMap } from "@/lib/types";
import { cn, formatLongDate, weekStartISO } from "@/lib/utils";

interface TrackerViewProps {
  date: string;
  habits: Habit[];
  initialLogs: LogMap;
  initialAwards: AwardMap;
}

export default function TrackerView({
  date,
  habits,
  initialLogs,
  initialAwards,
}: TrackerViewProps) {
  const { setBalance } = useWallet();
  const { multiplierForBlock } = useGame();
  const [logs, setLogs] = useState<LogMap>(initialLogs);
  const [awards, setAwards] = useState<AwardMap>(initialAwards);
  const [toast, setToast] = useState<string | null>(null);
  // Burst de monedas por hábito, disparado con el delta REAL que devuelve el RPC.
  const [bursts, setBursts] = useState<Record<string, { id: number; amount: number }>>(
    {},
  );
  const burstId = useRef(0);

  // Lunes de la semana en curso: los hábitos semanales anclan su log a esta
  // fecha, de modo que el estado se mantiene toda la semana y se reinicia solo
  // al arrancar la siguiente.
  const weekStart = useMemo(() => weekStartISO(date), [date]);

  // Separamos por cadencia: los diarios se agrupan por bloque horario; los
  // semanales van todos al Bloque Semanal (placa dorada).
  const { dailyHabits, weeklyHabits } = useMemo(() => {
    const dailyHabits: Habit[] = [];
    const weeklyHabits: Habit[] = [];
    for (const h of habits) {
      (h.frequency === "weekly" ? weeklyHabits : dailyHabits).push(h);
    }
    return { dailyHabits, weeklyHabits };
  }, [habits]);

  // Resumen del DÍA (solo hábitos diarios; usa el pago real acreditado).
  const { done, total, earnedToday } = useMemo(() => {
    let done = 0;
    let earnedToday = 0;
    for (const h of dailyHabits) {
      const s = logs[h.id] ?? "NONE";
      if (s !== "NONE") done += 1;
      earnedToday += awards[h.id] ?? 0;
    }
    return { done, total: dailyHabits.length, earnedToday };
  }, [dailyHabits, logs, awards]);

  // Resumen de la SEMANA (solo hábitos semanales).
  const { weeklyDone, weeklyEarned } = useMemo(() => {
    let weeklyDone = 0;
    let weeklyEarned = 0;
    for (const h of weeklyHabits) {
      if ((logs[h.id] ?? "NONE") !== "NONE") weeklyDone += 1;
      weeklyEarned += awards[h.id] ?? 0;
    }
    return { weeklyDone, weeklyEarned };
  }, [weeklyHabits, logs, awards]);

  const grouped = useMemo(
    () =>
      TIME_BLOCK_ORDER.map((block) => ({
        block,
        items: dailyHabits.filter((h) => h.time_block === block),
      })).filter((g) => g.items.length > 0),
    [dailyHabits],
  );

  function handleChange(habit: Habit, next: HabitStatus) {
    const prevStatus = logs[habit.id] ?? "NONE";
    if (next === prevStatus) return;

    const prevAward = awards[habit.id] ?? 0;
    // Los semanales anclan su log al LUNES de la semana; los diarios, a hoy.
    const logDate = habit.frequency === "weekly" ? weekStart : date;

    // 1) Optimista: sólo el estado (feedback inmediato del check). El balance y
    //    las monedas NO se calculan en el cliente: los define el RPC.
    setLogs((m) => ({ ...m, [habit.id]: next }));

    // 2) Persistencia: confiamos ciegamente en el balance/monedas del RPC.
    void (async () => {
      const res = await setHabitStatus(habit.id, logDate, next);

      if (!res.persisted) {
        setLogs((m) => ({ ...m, [habit.id]: prevStatus })); // rollback del estado
        setToast("No se pudo guardar. Revisá tu conexión / Supabase.");
        window.setTimeout(() => setToast(null), 3200);
        return;
      }

      if (res.balance !== null) setBalance(res.balance);
      if (res.coinsAwarded !== null) {
        const awarded = res.coinsAwarded;
        setAwards((m) => ({ ...m, [habit.id]: awarded }));
        // Burst con el delta REAL acreditado por el servidor.
        const delta = awarded - prevAward;
        if (delta !== 0) {
          burstId.current += 1;
          const id = burstId.current;
          setBursts((b) => ({ ...b, [habit.id]: { id, amount: delta } }));
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
      </section>

      {/* Bloque Semanal — placa dorada, distintivo ×5 */}
      {weeklyHabits.length > 0 && (
        <section
          aria-label={WEEKLY_BLOCK_META.label}
          className="animate-rise mb-7 rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/[0.10] to-gold/[0.02] p-4 shadow-[0_0_28px_-10px_rgba(246,196,69,0.6)]"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="text-lg" aria-hidden>
              {WEEKLY_BLOCK_META.icon}
            </span>
            <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-gold">
              {WEEKLY_BLOCK_META.label}
            </h2>
            <span className="h-px flex-1 bg-gradient-to-r from-gold/50 to-transparent" />
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {weeklyDone}/{weeklyHabits.length} · reinicia el lunes
            </p>
            <p className="font-mono text-[11px] font-bold tabular-nums text-gold">
              +{weeklyEarned.toLocaleString("es-AR")}
              <span className="ml-0.5 text-[9px]">🪙 esta semana</span>
            </p>
          </div>

          <div className="space-y-2.5">
            {weeklyHabits.map((habit, i) => (
              <HabitCard
                key={habit.id}
                name={habit.name}
                status={logs[habit.id] ?? "NONE"}
                reward={awards[habit.id] ?? 0}
                multiplierPercent={multiplierForBlock(habit.time_block)}
                accent={WEEKLY_BLOCK_META.accent}
                index={i}
                weekly
                multiplier={habit.multiplier}
                burst={bursts[habit.id] ?? null}
                onChange={(next) => handleChange(habit, next)}
              />
            ))}
          </div>
        </section>
      )}

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
                    burst={bursts[habit.id] ?? null}
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
