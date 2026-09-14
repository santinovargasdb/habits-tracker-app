import type { Habit, HabitStatus, LogMap, AwardMap } from "@/lib/types";

const PREFIX = "dojo:";
const K_SNAPSHOT = PREFIX + "tracker";
const K_OUTBOX = PREFIX + "outbox";
const K_LASTSYNC = PREFIX + "lastSync";

export interface TrackerSnapshot {
  date: string;
  habits: Habit[];
  logs: LogMap;
  awards: AwardMap;
  balance: number;
}

export interface OutboxEntry {
  habitId: string;
  logDate: string;
  status: HabitStatus;
  updatedAt: number;
}

function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null; // modo privado / storage bloqueado
  }
}

function readJSON<T>(key: string): T | null {
  const s = ls();
  if (!s) return null;
  try {
    const v = s.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, val: unknown): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(val));
  } catch {
    /* quota / private mode: degradamos a solo-online */
  }
}

export function readSnapshot(): TrackerSnapshot | null {
  return readJSON<TrackerSnapshot>(K_SNAPSHOT);
}
export function writeSnapshot(snap: TrackerSnapshot): void {
  writeJSON(K_SNAPSHOT, snap);
}
export function readOutbox(): OutboxEntry[] {
  return readJSON<OutboxEntry[]>(K_OUTBOX) ?? [];
}
export function writeOutbox(entries: OutboxEntry[]): void {
  writeJSON(K_OUTBOX, entries);
}
export function readLastSync(): number | null {
  return readJSON<number>(K_LASTSYNC);
}
export function writeLastSync(ts: number): void {
  writeJSON(K_LASTSYNC, ts);
}
