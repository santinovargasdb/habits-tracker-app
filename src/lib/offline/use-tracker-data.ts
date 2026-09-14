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

// Estado inicial DETERMINÍSTICO desde el seed del servidor: el primer render del
// cliente DEBE coincidir con el HTML del SSR (si lee localStorage acá, difiere y
// React tira hydration mismatch #418). El store local se hidrata DESPUÉS del
// montaje, en un effect (ver useTrackerData).
function fromSeed(seed: TrackerSnapshot | null): TrackerSnapshot {
  return (
    seed ?? { date: todayISO(), habits: [], logs: {}, awards: {}, balance: 0 }
  );
}

// Reinicio por cambio de día aplicado a un snapshot del store: los diarios se
// reinician; los semanales se conservan si seguimos en la misma semana (su log
// está anclado al lunes).
function rolledOver(base: TrackerSnapshot): TrackerSnapshot {
  const today = todayISO();
  if (base.date === today) return base;
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
  const [snap, setSnap] = useState<TrackerSnapshot>(() => fromSeed(seed));
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 1: unmount-safety ref
  const mountedRef = useRef(true);

  // Fix 2: snapshot ref to avoid side effects inside setState updater
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // Fix 1: cleanup on unmount. El `mountedRef.current = true` del cuerpo es
  // NECESARIO (no borrar): en StrictMode el effect corre → cleanup (pone false) →
  // corre de nuevo; sin re-setear a true, mountedRef quedaría en false y runSync
  // no actualizaría nunca el estado.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  // Hidratación del store local DESPUÉS del montaje. El primer render usó el seed
  // (idéntico al SSR); recién acá cargamos lo persistido, sin causar mismatch.
  // También hidratamos el saldo del store (único dueño del balance offline).
  useEffect(() => {
    const stored = readSnapshot();
    if (stored) {
      const s = rolledOver(stored);
      snapRef.current = s;
      setSnap(s);
      setBalance(s.balance);
    }
    setPendingCount(readOutbox().length);
  }, [setBalance]);

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
