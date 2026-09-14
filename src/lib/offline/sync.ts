"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureAppSession } from "@/actions/auth";
import { setHabitStatus } from "@/actions/habits";
import { todayISO, weekStartISO } from "@/lib/utils";
import { normalizeTimeBlock } from "@/lib/constants";
import * as outbox from "./outbox";
import { readSnapshot, writeSnapshot, writeLastSync, type TrackerSnapshot } from "./store";
import type { Habit, LogMap, AwardMap } from "@/lib/types";

/** Al hacer pull, conserva las claves que siguen pendientes en el outbox. */
export function mergePendingLogs(
  pulledLogs: LogMap,
  pulledAwards: AwardMap,
  pendingIds: Set<string>,
  prev: TrackerSnapshot | null,
): { logs: LogMap; awards: AwardMap } {
  const logs: LogMap = { ...pulledLogs };
  const awards: AwardMap = { ...pulledAwards };
  if (prev) {
    for (const id of pendingIds) {
      if (id in prev.logs) {
        logs[id] = prev.logs[id];
        awards[id] = prev.awards[id] ?? 0;
      }
    }
  }
  return { logs, awards };
}

let syncing = false;

export async function syncNow(): Promise<
  { ok: true; snapshot: TrackerSnapshot } | { ok: false; reason: string }
> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, reason: "offline" };
  if (syncing) return { ok: false, reason: "busy" };
  syncing = true;
  try {
    const auth = await ensureAppSession();
    if (!auth.ok) return { ok: false, reason: "auth" };

    // 1) Flush del outbox (orden por updatedAt).
    let lastBalance: number | null = null;
    const pending = [...outbox.all()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const e of pending) {
      const res = await setHabitStatus(e.habitId, e.logDate, e.status);
      if (!res.persisted) return { ok: false, reason: "flush" };
      if (res.balance !== null) lastBalance = res.balance;
      outbox.remove(e.habitId, e.logDate);
    }

    // 2) Pull fresco desde Supabase (cliente).
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return { ok: false, reason: "no-client" };

    const date = todayISO();
    const weekStart = weekStartISO(date);

    const { data: dbHabits } = await supabase
      .from("habits")
      .select("id, name, time_block, sort_order, frequency, multiplier")
      .order("sort_order", { ascending: true });
    const habits: Habit[] = ((dbHabits ?? []) as Array<Record<string, unknown>>).map((h) => ({
      ...h,
      time_block: normalizeTimeBlock(h.time_block),
      frequency: String(h.frequency ?? "daily").toLowerCase(),
      multiplier: typeof h.multiplier === "number" ? h.multiplier : 1,
    })) as Habit[];

    const weeklyIds = new Set(habits.filter((h) => h.frequency === "weekly").map((h) => h.id));
    const logDates = weekStart === date ? [date] : [date, weekStart];
    const { data: dbLogs } = await supabase
      .from("logs")
      .select("habit_id, status, coins_awarded, date")
      .in("date", logDates);

    const pulledLogs: LogMap = {};
    const pulledAwards: AwardMap = {};
    for (const row of (dbLogs ?? []) as Array<Record<string, unknown>>) {
      const habitId = String(row.habit_id);
      const expected = weeklyIds.has(habitId) ? weekStart : date;
      if (row.date !== expected) continue;
      pulledLogs[habitId] = row.status as LogMap[string];
      pulledAwards[habitId] = (row.coins_awarded as number) ?? 0;
    }

    const { data: wallet } = await supabase.from("wallet").select("balance").limit(1).maybeSingle();
    const balance = (wallet?.balance as number | undefined) ?? lastBalance ?? readSnapshot()?.balance ?? 0;

    // Conservar claves aún pendientes (por si entró una marca durante el pull).
    const stillPending = new Set(outbox.all().map((e) => e.habitId));
    const { logs, awards } = mergePendingLogs(pulledLogs, pulledAwards, stillPending, readSnapshot());

    const snapshot: TrackerSnapshot = { date, habits, logs, awards, balance };
    writeSnapshot(snapshot);
    writeLastSync(Date.now());
    return { ok: true, snapshot };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    syncing = false;
  }
}
