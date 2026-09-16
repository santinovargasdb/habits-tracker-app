"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import HabitCard from "@/components/habit-card";
import { useGame } from "@/lib/game-context";
import {
  TIME_BLOCK_META,
  TIME_BLOCK_ORDER,
  WEEKLY_BLOCK_META,
} from "@/lib/constants";
import type { Habit, HabitStatus } from "@/lib/types";
import { cn, formatLongDate } from "@/lib/utils";
import { useTrackerData } from "@/lib/offline/use-tracker-data";
import type { TrackerSnapshot } from "@/lib/offline/store";
import { optimisticReward } from "@/lib/offline/reward";
import ActivityBar from "@/components/activity-bar";

interface TrackerViewProps {
  seed: TrackerSnapshot | null;
}

export default function TrackerView({ seed }: TrackerViewProps) {
  const { multiplierForBlock } = useGame();
  const { date, habits, logs, awards, online, pendingCount, hasData, mark, syncError } =
    useTrackerData(seed);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!syncError) return;
    setToast(syncError);
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [syncError]);
  const [bursts, setBursts] = useState<Record<string, { id: number; amount: number }>>(
    {},
  );
  const burstId = useRef(0);

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

  // Diarios cuyo time_block no es uno de los 4 canónicos: los mostramos igual
  // en una sección "Otros" para no ocultar ningún hábito.
  const otros = useMemo(
    () =>
      dailyHabits.filter(
        (h) => !(TIME_BLOCK_ORDER as readonly string[]).includes(h.time_block),
      ),
    [dailyHabits],
  );

  function handleChange(habit: Habit, next: HabitStatus) {
    const prevStatus = logs[habit.id] ?? "NONE";
    if (next === prevStatus) return;

    const prevAward = awards[habit.id] ?? 0;
    mark(habit, next);
    // Burst con el delta optimista (el server reconcilia el saldo al sincronizar).
    const reward = optimisticReward({ status: next, frequency: habit.frequency, deckBonusPercent: 0 });
    const delta = reward - prevAward;
    if (delta !== 0) {
      burstId.current += 1;
      const id = burstId.current;
      setBursts((b) => ({ ...b, [habit.id]: { id, amount: delta } }));
    }
  }

  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      {/* Racha + heatmap de actividad */}
      {habits.length > 0 && <ActivityBar habits={habits} today={date} />}
      {/* Hero */}
      <section className="animate-rise mb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
          Hoy · {date}
        </p>
        <h1 className="mt-1 font-display text-[26px] font-extrabold capitalize leading-tight tracking-tight text-fg">
          {formatLongDate(date)}
        </h1>

        {(!online || pendingCount > 0) && (
          <div className="mt-2 flex items-center gap-2">
            {!online && (
              <span className="rounded-full border border-line bg-surface/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                ● Offline
              </span>
            )}
            {pendingCount > 0 && (
              <span className="rounded-full border border-gold/30 bg-gold/12 px-2 py-0.5 font-mono text-[10px] font-bold text-gold">
                {pendingCount} pendiente{pendingCount === 1 ? "" : "s"} de sincronizar
              </span>
            )}
          </div>
        )}
        {!hasData && (
          <p className="mt-3 rounded-xl border border-line bg-surface/70 p-3 text-sm text-muted">
            Conectate a internet una vez para cargar tus hábitos.
          </p>
        )}

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
            <WEEKLY_BLOCK_META.icon className="h-5 w-5 shrink-0 text-gold" aria-hidden />
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
                <meta.icon className="h-5 w-5 shrink-0" style={{ color: meta.accent }} aria-hidden />
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

        {/* Otros — diarios sin un bloque horario canónico */}
        {otros.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="text-lg" aria-hidden>
                🗂️
              </span>
              <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-muted">
                Otros
              </h2>
              <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
            </div>
            <div className="space-y-2.5">
              {otros.map((habit, i) => (
                <HabitCard
                  key={habit.id}
                  name={habit.name}
                  status={logs[habit.id] ?? "NONE"}
                  reward={awards[habit.id] ?? 0}
                  multiplierPercent={0}
                  accent="#9797a6"
                  index={i}
                  burst={bursts[habit.id] ?? null}
                  onChange={(next) => handleChange(habit, next)}
                />
              ))}
            </div>
          </section>
        )}
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
