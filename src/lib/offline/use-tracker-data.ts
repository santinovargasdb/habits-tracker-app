"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Habit, HabitStatus, LogMap, AwardMap } from "@/lib/types";
import { todayISO, weekStartISO } from "@/lib/utils";
import { useWallet } from "@/lib/wallet-context";
import { readSnapshot, writeSnapshot, readOutbox, type TrackerSnapshot } from "./store";
import * as outbox from "./outbox";
import { optimisticReward } from "./reward";
import { syncNow } from "./sync";
import { useOnline } from "./use-online";

function initial(seed: TrackerSnapshot | null): TrackerSnapshot {
  const stored = readSnapshot();
  const today = todayISO();
  const base = stored ?? seed ?? { date: today, habits: [], logs: {}, awards: {}, balance: 0 };
  if (base.date === today) return base;
  // Nuevo día: los logs DIARIOS se reinician; los SEMANALES se conservan si
  // seguimos en la misma semana (su log está anclado al lunes).
  const sameWeek = weekStartISO(base.date) === weekStartISO(today);
  const weeklyIds = new Set(
    base.habits.filter((h) => h.frequency === "weekly").map((h) => h.id),
  );
  const logs: LogMap = {};
  const awards: AwardMap = {};
  if (sameWeek) {
    for (const id of Object.keys(base.logs)) {
      if (weeklyIds.has(id)) {
        logs[id] = base.logs[id];
        awards[id] = base.awards[id] ?? 0;
      }
    }
  }
  return { ...base, date: today, logs, awards };
}

export function useTrackerData(seed: TrackerSnapshot | null) {
  const online = useOnline();
  const { setBalance } = useWallet();
  const [snap, setSnap] = useState<TrackerSnapshot>(() => initial(seed));
  const [pendingCount, setPendingCount] = useState<number>(() => readOutbox().length);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 1: unmount-safety ref
  const mountedRef = useRef(true);

  // Fix 2: snapshot ref to avoid side effects inside setState updater
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // Fix 1: cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  const refreshPending = useCallback(() => setPendingCount(readOutbox().length), []);

  const runSync = useCallback(async () => {
    const res = await syncNow();
    // Fix 1: guard setState calls after unmount
    if (!mountedRef.current) return;
    if (res.ok) {
      // Fix 2: keep snapRef in sync from runSync success path
      snapRef.current = res.snapshot;
      setSnap(res.snapshot);
      setBalance(res.snapshot.balance);
      setSyncError(null);
    } else if (res.reason !== "offline" && res.reason !== "busy") {
      setSyncError("No se pudo sincronizar. Reintentaremos.");
    }
    refreshPending();
  }, [setBalance, refreshPending]);

  // Al montar (si online) y cuando volvemos online: sincronizar.
  useEffect(() => {
    if (online) void runSync();
  }, [online, runSync]);

  const mark = useCallback(
    (habit: Habit, status: HabitStatus) => {
      const date = todayISO();
      const logDate = habit.frequency === "weekly" ? weekStartISO(date) : date;

      // Fix 2: compute next outside any setState updater using snapRef
      const prev = snapRef.current;
      const prevReward = prev.awards[habit.id] ?? 0;
      const reward = optimisticReward({ status, frequency: habit.frequency, deckBonusPercent: 0 });
      const logs: LogMap = { ...prev.logs, [habit.id]: status };
      const awards: AwardMap = { ...prev.awards, [habit.id]: reward };
      const balance = prev.balance + (reward - prevReward);
      const next: TrackerSnapshot = { ...prev, date, logs, awards, balance };

      // Fix 2: all side effects happen outside any updater, synchronously
      snapRef.current = next;
      setSnap(next);
      writeSnapshot(next);
      setBalance(next.balance);

      outbox.enqueue({ habitId: habit.id, logDate, status, updatedAt: Date.now() });
      refreshPending();
      if (online) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => void runSync(), 500);
      }
    },
    [online, runSync, refreshPending, setBalance],
  );

  return {
    date: snap.date,
    habits: snap.habits,
    logs: snap.logs,
    awards: snap.awards,
    online,
    pendingCount,
    hasData: snap.habits.length > 0,
    mark,
    syncError,
  };
}
