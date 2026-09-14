import { readOutbox, writeOutbox, type OutboxEntry } from "./store";

const key = (habitId: string, logDate: string) => `${habitId}:${logDate}`;

export function enqueue(entry: OutboxEntry): void {
  const map = new Map(readOutbox().map((e) => [key(e.habitId, e.logDate), e]));
  const k = key(entry.habitId, entry.logDate);
  const existing = map.get(k);
  if (!existing || entry.updatedAt >= existing.updatedAt) map.set(k, entry);
  writeOutbox([...map.values()]);
}

export function all(): OutboxEntry[] {
  return readOutbox();
}

export function remove(habitId: string, logDate: string): void {
  const k = key(habitId, logDate);
  writeOutbox(readOutbox().filter((e) => key(e.habitId, e.logDate) !== k));
}

export function clear(): void {
  writeOutbox([]);
}
