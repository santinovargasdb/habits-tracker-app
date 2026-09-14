# Tracker offline-first — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Tracker lea/escriba de un store local (localStorage), funcione offline y sincronice con Supabase al reconectar — eliminando de paso el parpadeo `0/0`.

**Architecture:** Módulos puros bajo `src/lib/offline/` (store, outbox, reward, sync) + hooks cliente (use-online, use-tracker-data). El Tracker renderiza desde el store local al hidratar; las marcas van a un outbox coalescido y se reproducen contra `set_habit_status` al volver online; el balance del server reconcilia. El header/saldo pasa a client-first vía el wallet-context.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase JS (`@supabase/ssr`), Vitest + jsdom (nuevo, para unit de lógica pura).

## Global Constraints

- Economía sin cambios: MET=50, SURPASSED=150, NONE=0; semanal ×5; bonus del mazo = suma de `multiplier_percent` de equipadas (MVP: mazo vacío → 0). El server (`set_habit_status`) es la verdad final.
- Solo el Tracker es offline; Casino/Mercado/Finanzas quedan online-only.
- Storage: `localStorage` detrás de `src/lib/offline/store.ts` (único punto que toca `localStorage`).
- Conflictos: last-write-wins por `(habitId, logDate)` con `updatedAt` (epoch ms).
- El primer uso requiere internet (sembrar hábitos + sesión). Sin store previo y offline → aviso.
- No romper el build: `npx tsc --noEmit` y `npm run build` deben pasar.
- Alias de imports: `@/` → `src/` (ya en tsconfig; se replica en vitest.config.ts).
- Tipos del dominio en `@/lib/types`: `Habit`, `HabitStatus` (`"NONE"|"MET"|"SURPASSED"`), `HabitFrequency` (`"daily"|"weekly"`), `LogMap` (`Record<string,HabitStatus>`), `AwardMap` (`Record<string,number>`).
- Utils existentes en `@/lib/utils`: `todayISO(): string`, `weekStartISO(date: string): string`. Constante existente `normalizeTimeBlock` en `@/lib/constants`.

---

### Task 1: Setup de Vitest + módulo `reward` (lógica pura de monedas)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDeps + script `test`)
- Create: `src/lib/offline/reward.ts`
- Test: `src/lib/offline/reward.test.ts`

**Interfaces:**
- Produces: `optimisticReward(params: { status: HabitStatus; frequency: HabitFrequency; deckBonusPercent?: number }): number`

- [ ] **Step 1: Instalar Vitest + jsdom**

Run:
```bash
npm install -D vitest@^2 jsdom@^25
```
Expected: se agregan a `devDependencies` sin errores.

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "jsdom", globals: true },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 3: Agregar el script de test a `package.json`**

En `"scripts"` agregar:
```json
"test": "vitest run"
```

- [ ] **Step 4: Escribir el test que falla (`src/lib/offline/reward.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { optimisticReward } from "./reward";

describe("optimisticReward", () => {
  it("diario: MET=50, SURPASSED=150, NONE=0", () => {
    expect(optimisticReward({ status: "MET", frequency: "daily" })).toBe(50);
    expect(optimisticReward({ status: "SURPASSED", frequency: "daily" })).toBe(150);
    expect(optimisticReward({ status: "NONE", frequency: "daily" })).toBe(0);
  });
  it("semanal aplica ×5", () => {
    expect(optimisticReward({ status: "MET", frequency: "weekly" })).toBe(250);
    expect(optimisticReward({ status: "SURPASSED", frequency: "weekly" })).toBe(750);
  });
  it("aplica el bonus del mazo y redondea", () => {
    expect(optimisticReward({ status: "MET", frequency: "daily", deckBonusPercent: 10 })).toBe(55);
    expect(optimisticReward({ status: "SURPASSED", frequency: "weekly", deckBonusPercent: 20 })).toBe(900);
  });
});
```

- [ ] **Step 5: Correr el test — debe fallar**

Run: `npm test -- reward`
Expected: FAIL (no existe `./reward`).

- [ ] **Step 6: Implementar `src/lib/offline/reward.ts`**

```ts
import type { HabitStatus, HabitFrequency } from "@/lib/types";

const BASE: Record<HabitStatus, number> = { NONE: 0, MET: 50, SURPASSED: 150 };

/**
 * Cálculo optimista de monedas para el marcado offline. Espeja la fórmula de
 * `set_habit_status`: base 50/150 × factor de cadencia (×5 semanal) × (1 + bonus
 * del mazo). El servidor reconcilia al sincronizar, así que un desvío del bonus
 * se auto-corrige.
 */
export function optimisticReward(params: {
  status: HabitStatus;
  frequency: HabitFrequency;
  deckBonusPercent?: number;
}): number {
  const base = BASE[params.status] ?? 0;
  if (base === 0) return 0;
  const weekly = params.frequency === "weekly" ? 5 : 1;
  const bonus = params.deckBonusPercent ?? 0;
  return Math.round((base * weekly * (100 + bonus)) / 100);
}
```

- [ ] **Step 7: Correr el test — debe pasar**

Run: `npm test -- reward`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/offline/reward.ts src/lib/offline/reward.test.ts
git commit -m "feat(offline): vitest + reward.optimisticReward (calculo optimista de monedas)"
```

---

### Task 2: Módulo `store` (persistencia local sobre localStorage)

**Files:**
- Create: `src/lib/offline/store.ts`
- Test: `src/lib/offline/store.test.ts`

**Interfaces:**
- Produces:
  - `interface TrackerSnapshot { date: string; habits: Habit[]; logs: LogMap; awards: AwardMap; balance: number }`
  - `interface OutboxEntry { habitId: string; logDate: string; status: HabitStatus; updatedAt: number }`
  - `readSnapshot(): TrackerSnapshot | null`, `writeSnapshot(s: TrackerSnapshot): void`
  - `readOutbox(): OutboxEntry[]`, `writeOutbox(e: OutboxEntry[]): void`
  - `readLastSync(): number | null`, `writeLastSync(ts: number): void`

- [ ] **Step 1: Escribir el test que falla (`src/lib/offline/store.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  readSnapshot, writeSnapshot, readOutbox, writeOutbox,
  readLastSync, writeLastSync, type TrackerSnapshot, type OutboxEntry,
} from "./store";

const snap: TrackerSnapshot = {
  date: "2026-09-14",
  habits: [{ id: "h1", name: "x", time_block: "Madrugada", sort_order: 0, frequency: "daily", multiplier: 1 }],
  logs: { h1: "MET" },
  awards: { h1: 50 },
  balance: 50,
};

describe("store", () => {
  beforeEach(() => localStorage.clear());

  it("round-trip del snapshot", () => {
    expect(readSnapshot()).toBeNull();
    writeSnapshot(snap);
    expect(readSnapshot()).toEqual(snap);
  });

  it("outbox default [] y round-trip", () => {
    expect(readOutbox()).toEqual([]);
    const e: OutboxEntry[] = [{ habitId: "h1", logDate: "2026-09-14", status: "MET", updatedAt: 1 }];
    writeOutbox(e);
    expect(readOutbox()).toEqual(e);
  });

  it("lastSync round-trip", () => {
    expect(readLastSync()).toBeNull();
    writeLastSync(123);
    expect(readLastSync()).toBe(123);
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm test -- store`
Expected: FAIL (no existe `./store`).

- [ ] **Step 3: Implementar `src/lib/offline/store.ts`**

```ts
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
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm test -- store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/store.ts src/lib/offline/store.test.ts
git commit -m "feat(offline): store local (snapshot + outbox + lastSync) sobre localStorage"
```

---

### Task 3: Módulo `outbox` (cola coalescida de cambios)

**Files:**
- Create: `src/lib/offline/outbox.ts`
- Test: `src/lib/offline/outbox.test.ts`

**Interfaces:**
- Consumes: `store.readOutbox/writeOutbox`, `OutboxEntry`.
- Produces: `enqueue(entry: OutboxEntry): void`, `all(): OutboxEntry[]`, `remove(habitId: string, logDate: string): void`, `clear(): void`.

- [ ] **Step 1: Escribir el test que falla (`src/lib/offline/outbox.test.ts`)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as outbox from "./outbox";
import type { OutboxEntry } from "./store";

const mk = (status: OutboxEntry["status"], updatedAt: number): OutboxEntry => ({
  habitId: "h1", logDate: "2026-09-14", status, updatedAt,
});

describe("outbox", () => {
  beforeEach(() => localStorage.clear());

  it("coalesce por (habitId, logDate): gana el updatedAt mayor", () => {
    outbox.enqueue(mk("MET", 100));
    outbox.enqueue(mk("SURPASSED", 200));
    const all = outbox.all();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("SURPASSED");
  });

  it("no pisa con un updatedAt menor", () => {
    outbox.enqueue(mk("SURPASSED", 200));
    outbox.enqueue(mk("MET", 100));
    expect(outbox.all()[0].status).toBe("SURPASSED");
  });

  it("remove y clear", () => {
    outbox.enqueue(mk("MET", 100));
    outbox.remove("h1", "2026-09-14");
    expect(outbox.all()).toEqual([]);
    outbox.enqueue(mk("MET", 100));
    outbox.clear();
    expect(outbox.all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm test -- outbox`
Expected: FAIL (no existe `./outbox`).

- [ ] **Step 3: Implementar `src/lib/offline/outbox.ts`**

```ts
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
  writeOutbox(readOutbox().filter((e) => key(e.habitId, e.logDate) !== key(habitId, logDate)));
}

export function clear(): void {
  writeOutbox([]);
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm test -- outbox`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/outbox.ts src/lib/offline/outbox.test.ts
git commit -m "feat(offline): outbox coalescido por (habitId, logDate) con LWW"
```

---

### Task 4: Hook `useOnline` (conectividad)

**Files:**
- Create: `src/lib/offline/use-online.ts`

**Interfaces:**
- Produces: `useOnline(): boolean`

- [ ] **Step 1: Implementar `src/lib/offline/use-online.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

/** true si el navegador está online; escucha los eventos 'online'/'offline'. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/offline/use-online.ts
git commit -m "feat(offline): hook useOnline"
```

---

### Task 5: Módulo `sync` (flush del outbox + pull de Supabase)

**Files:**
- Create: `src/lib/offline/sync.ts`
- Test: `src/lib/offline/sync.test.ts` (solo el helper puro `mergePendingLogs`)

**Interfaces:**
- Consumes: `ensureAppSession` (`@/actions/auth`), `setHabitStatus` (`@/actions/habits`), `createSupabaseBrowserClient` (`@/lib/supabase/client`), `todayISO/weekStartISO` (`@/lib/utils`), `normalizeTimeBlock` (`@/lib/constants`), `outbox`, `store`.
- Produces:
  - `mergePendingLogs(pulledLogs: LogMap, pulledAwards: AwardMap, pendingIds: Set<string>, prev: TrackerSnapshot | null): { logs: LogMap; awards: AwardMap }`
  - `syncNow(): Promise<{ ok: true; snapshot: TrackerSnapshot } | { ok: false; reason: string }>`

- [ ] **Step 1: Escribir el test del helper puro (`src/lib/offline/sync.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { mergePendingLogs } from "./sync";
import type { TrackerSnapshot } from "./store";

const prev: TrackerSnapshot = {
  date: "2026-09-14", habits: [], logs: { h1: "SURPASSED" }, awards: { h1: 150 }, balance: 150,
};

describe("mergePendingLogs", () => {
  it("preserva las claves pendientes desde el snapshot previo", () => {
    const { logs, awards } = mergePendingLogs(
      { h1: "MET", h2: "MET" }, { h1: 50, h2: 50 }, new Set(["h1"]), prev,
    );
    expect(logs.h1).toBe("SURPASSED"); // pendiente: gana el local
    expect(awards.h1).toBe(150);
    expect(logs.h2).toBe("MET");       // no pendiente: gana el server
    expect(awards.h2).toBe(50);
  });

  it("sin pendientes devuelve lo pulled tal cual", () => {
    const { logs } = mergePendingLogs({ h2: "MET" }, { h2: 50 }, new Set(), prev);
    expect(logs).toEqual({ h2: "MET" });
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm test -- sync`
Expected: FAIL (no existe `./sync`).

- [ ] **Step 3: Implementar `src/lib/offline/sync.ts`**

```ts
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
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm test -- sync`
Expected: PASS (2 tests). (El resto de `syncNow` se valida en el E2E de la Task 11.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/offline/sync.ts src/lib/offline/sync.test.ts
git commit -m "feat(offline): sync (flush del outbox + pull de Supabase) y mergePendingLogs"
```

---

### Task 6: Hook `useTrackerData` (estado del Tracker desde el store)

**Files:**
- Create: `src/lib/offline/use-tracker-data.ts`

**Interfaces:**
- Consumes: `store` (`readSnapshot/writeSnapshot`, `TrackerSnapshot`), `outbox.enqueue`, `optimisticReward`, `syncNow`, `useOnline`, `useWallet` (`@/lib/wallet-context`), `todayISO/weekStartISO`.
- Produces:
  ```ts
  function useTrackerData(seed: TrackerSnapshot | null): {
    date: string; habits: Habit[]; logs: LogMap; awards: AwardMap;
    online: boolean; pendingCount: number; hasData: boolean;
    mark: (habit: Habit, status: HabitStatus) => void;
  }
  ```

- [ ] **Step 1: Verificar la interfaz de `useWallet`**

Run: `sed -n '1,60p' src/lib/wallet-context.tsx`
Expected: expone un provider con `balance: number` y `setBalance: (n: number) => void` vía `useWallet()`. (Si el nombre difiere, usar el real en el paso siguiente.)

- [ ] **Step 2: Implementar `src/lib/offline/use-tracker-data.ts`**

```ts
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
  // Si el snapshot guardado es de otro día, reseteamos los logs diarios (los
  // semanales se re-piden en el pull; el marcado local se rehace igual).
  if (base.date !== today) return { ...base, date: today, logs: {}, awards: {} };
  return base;
}

export function useTrackerData(seed: TrackerSnapshot | null) {
  const online = useOnline();
  const { setBalance } = useWallet();
  const [snap, setSnap] = useState<TrackerSnapshot>(() => initial(seed));
  const [pendingCount, setPendingCount] = useState<number>(() => readOutbox().length);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPending = useCallback(() => setPendingCount(readOutbox().length), []);

  const runSync = useCallback(async () => {
    const res = await syncNow();
    if (res.ok) {
      setSnap(res.snapshot);
      setBalance(res.snapshot.balance);
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
      setSnap((prev) => {
        const prevReward = prev.awards[habit.id] ?? 0;
        const reward = optimisticReward({ status, frequency: habit.frequency, deckBonusPercent: 0 });
        const logs: LogMap = { ...prev.logs, [habit.id]: status };
        const awards: AwardMap = { ...prev.awards, [habit.id]: reward };
        const balance = prev.balance + (reward - prevReward);
        const next: TrackerSnapshot = { ...prev, date, logs, awards, balance };
        writeSnapshot(next);
        setBalance(balance);
        return next;
      });
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
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/offline/use-tracker-data.ts
git commit -m "feat(offline): useTrackerData (estado del Tracker desde el store + marca optimista)"
```

---

### Task 7: Rewire del Tracker a client-first (page → app-shell → tracker-view)

**Files:**
- Modify: `src/app/page.tsx` (construir `seed` y pasarlo)
- Modify: `src/components/app-shell.tsx` (pasar `seed` a `TrackerView`)
- Modify: `src/components/tracker-view.tsx` (consumir `useTrackerData`)

**Interfaces:**
- Consumes: `useTrackerData(seed)`, `TrackerSnapshot`.
- Produces: el Tracker renderiza desde el store local (sin depender de props SSR de logs/habits).

- [ ] **Step 1: `page.tsx` — construir y pasar `seed`**

En `src/app/page.tsx`, tras armar `habits/logs/awards`, reemplazar el `return (<AppShell ... />)` por uno que pase `seed`:

```tsx
  const seed = {
    date,
    habits,
    logs,
    awards,
    balance: 0, // el saldo lo maneja el wallet-context / store local
  };

  return (
    <AppShell
      seed={seed}
      cards={cards}
      inventory={inventory}
      initialDeck={deck}
      initialInvestments={investments}
    />
  );
```
(Se eliminan del `AppShell` los props `date/habits/initialLogs/initialAwards`, ahora dentro de `seed`.)

- [ ] **Step 2: `app-shell.tsx` — aceptar `seed` y pasarlo a `TrackerView`**

Reemplazar la interfaz y el uso:

```tsx
import type { TrackerSnapshot } from "@/lib/offline/store";
// ...
interface AppShellProps {
  seed: TrackerSnapshot | null;
  cards: Card[];
  inventory: OwnedCard[];
  initialDeck: Deck;
  initialInvestments: Investment[];
}

export default function AppShell({
  seed, cards, inventory, initialDeck, initialInvestments,
}: AppShellProps) {
  const [tab, setTab] = useState<AppTab>("tracker");
  return (
    <GameProvider cards={cards} inventory={inventory} initialDeck={initialDeck}>
      <div hidden={tab !== "tracker"}>
        <TrackerView seed={seed} />
      </div>
      {/* ...resto igual (deck/store/finances/bottom-nav)... */}
    </GameProvider>
  );
}
```
(Quitar del import de tipos los que ya no se usen: `AwardMap, Habit, LogMap`.)

- [ ] **Step 3: `tracker-view.tsx` — consumir `useTrackerData`**

Reemplazar la firma/props y el estado. Cambios puntuales:

Imports (agregar/ajustar):
```tsx
import { useMemo, useRef, useState } from "react";
import { useTrackerData } from "@/lib/offline/use-tracker-data";
import type { TrackerSnapshot } from "@/lib/offline/store";
import type { Habit, HabitStatus } from "@/lib/types";
```

Firma y cabecera del componente (reemplaza el bloque `interface TrackerViewProps { ... }` y la
desestructuración de props + los `useState(initialLogs/initialAwards)`):
```tsx
interface TrackerViewProps {
  seed: TrackerSnapshot | null;
}

export default function TrackerView({ seed }: TrackerViewProps) {
  const { multiplierForBlock } = useGame();
  const { date, habits, logs, awards, online, pendingCount, hasData, mark } =
    useTrackerData(seed);
  const [toast, setToast] = useState<string | null>(null);
  const [bursts, setBursts] = useState<Record<string, { id: number; amount: number }>>({});
  const burstId = useRef(0);
```
(Se eliminan: `useWallet()` de acá —el saldo lo maneja `useTrackerData`—, los `useState<LogMap>(initialLogs)` y `useState<AwardMap>(initialAwards)`, y el `weekStart` si ya no se usa fuera de `mark`. `date`, `habits`, `logs`, `awards` ahora vienen del hook.)

Reemplazar `handleChange` por un uso directo de `mark` con burst local:
```tsx
  function handleChange(habit: Habit, next: HabitStatus) {
    const prevStatus = logs[habit.id] ?? "NONE";
    if (next === prevStatus) return;
    const prevAward = awards[habit.id] ?? 0;
    mark(habit, next);
    // Burst con el delta optimista (el server reconcilia el saldo al sincronizar).
    const { optimisticReward } = requireReward();
    const reward = optimisticReward({ status: next, frequency: habit.frequency, deckBonusPercent: 0 });
    const delta = reward - prevAward;
    if (delta !== 0) {
      burstId.current += 1;
      const id = burstId.current;
      setBursts((b) => ({ ...b, [habit.id]: { id, amount: delta } }));
    }
  }
```
Y agregar el import directo (sin `requireReward`, era ilustrativo):
```tsx
import { optimisticReward } from "@/lib/offline/reward";
```
…y usar `optimisticReward(...)` directamente en `handleChange` (borrar la línea `requireReward`).

- [ ] **Step 4: Indicadores offline/pendientes en el hero**

Dentro del `<section>` "Hero" de `tracker-view.tsx`, debajo del `<h1>` de la fecha, agregar:
```tsx
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
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0 (sin errores de tipos ni de build).

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/app-shell.tsx src/components/tracker-view.tsx
git commit -m "feat(offline): Tracker client-first desde el store local (mata el 0/0)"
```

---

### Task 8: Header/saldo client-first (layout + wallet-provider + indicador)

**Files:**
- Modify: `src/app/layout.tsx` (renderizar Header siempre)
- Modify: `src/components/client-wallet-provider.tsx` (inicializar saldo desde el store)
- Modify: `src/components/header.tsx` (tolerar `userEmail` nulo)

**Interfaces:**
- Consumes: `store.readSnapshot`.
- Produces: header + saldo visibles offline, sin depender del SSR `authed`.

- [ ] **Step 1: `client-wallet-provider.tsx` — inicializar del store**

Al montar, si hay snapshot local, usar su `balance` (cae al `initialBalance` SSR si no hay). Reemplazar la inicialización del estado por:
```tsx
"use client";
import { useEffect } from "react";
import { WalletProvider, useWallet } from "@/lib/wallet-context";
import { readSnapshot } from "@/lib/offline/store";

function BalanceHydrator() {
  const { setBalance } = useWallet();
  useEffect(() => {
    const snap = readSnapshot();
    if (snap) setBalance(snap.balance);
  }, [setBalance]);
  return null;
}

export function ClientWalletProvider({
  initialBalance, children,
}: { initialBalance: number; children: React.ReactNode }) {
  return (
    <WalletProvider initialBalance={initialBalance}>
      <BalanceHydrator />
      {children}
    </WalletProvider>
  );
}
```
(Si el `ClientWalletProvider` actual ya envuelve `WalletProvider` de otra forma, mantener su estructura y solo agregar el `<BalanceHydrator />` como primer hijo.)

- [ ] **Step 2: `layout.tsx` — Header siempre visible**

Reemplazar `{authed && <Header userEmail={email} />}` por `<Header userEmail={email} />` (el Header se muestra siempre; offline `email` puede ser null). El resto de `getSessionChrome` queda igual (aporta el `initialBalance` cuando hay sesión).

- [ ] **Step 3: `header.tsx` — tolerar email nulo**

Verificar la firma; asegurar que `userEmail?: string | null` y que el botón "Cerrar sesión" no rompa si es null (mostrar el botón solo si hay email):
```tsx
{userEmail && (
  <button aria-label={`Cerrar sesión de ${userEmail}`} /* ...igual que antes... */ />
)}
```

Run (para ver la firma actual): `sed -n '1,80p' src/components/header.tsx`
Aplicar el guard sobre el bloque del botón de logout / email.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/components/client-wallet-provider.tsx src/components/header.tsx
git commit -m "feat(offline): header/saldo client-first (visibles offline, sin parpadeo)"
```

---

### Task 9: Service worker — cachear shell + estáticos

**Files:**
- Modify: `public/sw.js`

**Interfaces:**
- Produces: la app carga offline tras la primera visita (shell + `/_next/static` + íconos), con passthrough de POST y Supabase.

- [ ] **Step 1: Reemplazar `public/sw.js`**

```js
// Service worker: shell + estáticos para uso offline del Tracker.
const CACHE = "dojo-ledger-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Solo GET del mismo origen; POST (Server Actions) y Supabase pasan directo.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Estáticos de Next (hasheados): stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        }).catch(() => cached);
        return cached || fetched;
      }),
    );
    return;
  }

  // Navegaciones / resto GET: network-first con fallback al shell "/".
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match("/"))),
  );
});
```

- [ ] **Step 2: Nota de versión**

El nombre de cache cambió a `dojo-ledger-v2`, por lo que el `activate` limpia el cache viejo (`v1`). El registrar (`service-worker-registrar.tsx`) no cambia.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: EXIT 0 (el SW es estático en `public/`, no lo procesa el build).

- [ ] **Step 4: Commit**

```bash
git add public/sw.js
git commit -m "feat(offline): SW v2 cachea shell + /_next/static (network-first con fallback)"
```

---

### Task 10: Gating online-only de Casino/Mercado/Finanzas

**Files:**
- Modify: `src/components/store-view.tsx`
- Modify: `src/components/finances-view.tsx`
- Modify: `src/components/casino-view.tsx`

**Interfaces:**
- Consumes: `useOnline`.
- Produces: cuando `!online`, estas vistas muestran un aviso "necesitás internet" en vez de acciones que fallarían.

- [ ] **Step 1: Agregar el guard offline en cada vista**

En cada uno de los tres componentes, al inicio del render:
```tsx
import { useOnline } from "@/lib/offline/use-online";
// ...dentro del componente, antes del return principal:
const online = useOnline();
if (!online) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <p className="rounded-2xl border border-line bg-surface/70 p-4 text-center text-sm text-muted">
        Esta sección necesita internet. Volvé a conectarte para usarla.
      </p>
    </div>
  );
}
```
(Casino: si `casino-view.tsx` es contenedor de blackjack/ruleta, poner el guard ahí. Verificar con `sed -n '1,40p' src/components/casino-view.tsx` cuál es el componente montado por `AppShell` en la tab "mercado"/"finanzas"/casino y aplicar el guard en el correcto.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/store-view.tsx src/components/finances-view.tsx src/components/casino-view.tsx
git commit -m "feat(offline): Mercado/Finanzas/Casino muestran aviso cuando no hay internet"
```

---

### Task 11: Verificación E2E offline + push

**Files:** ninguno (verificación).

**Interfaces:**
- Consumes: todo lo anterior desplegado.

- [ ] **Step 1: Correr toda la suite de unit**

Run: `npm test`
Expected: PASS (reward, store, outbox, sync).

- [ ] **Step 2: Push para deploy**

```bash
git push origin master
```
Expected: Vercel redeploya.

- [ ] **Step 3: E2E offline (con navegador, tras el deploy)**

Guion (Playwright o navegador manual):
1. Abrir la app online, esperar que cargue el Tracker (hidrata del server → store local).
2. Cortar la red (DevTools → Network → Offline, o `navigator` offline).
3. Recargar: la app debe cargar del shell cacheado + store local (hábitos visibles, chip "Offline").
4. Marcar un hábito diario "Hecho" → se ve +50 optimista y aparece "1 pendiente de sincronizar".
5. Recargar offline: el estado marcado persiste (store local).
6. Volver online → en ~1-2s el chip de pendientes desaparece (sync flush).
7. Verificar en Supabase (SQL Editor) que el log quedó:
   `select habit_id, date, status, coins_awarded from logs order by updated_at desc limit 5;`
   Expected: el hábito marcado aparece con `status='MET'`.

- [ ] **Step 4: Confirmar que NO hay parpadeo 0/0**

Abrir la app online (con store ya poblado) y confirmar que los hábitos aparecen inmediatamente (sin ventana de `0/0`).

---

## Self-Review

**Spec coverage:**
- Store local (localStorage, módulo aislado) → Task 2. ✅
- Outbox coalescido + LWW → Task 3. ✅
- Reward optimista (espeja server) → Task 1. ✅
- Sync (flush + pull, no pisa pendientes) → Task 5. ✅
- Conectividad → Task 4. ✅
- Estado del Tracker desde store + marca optimista → Task 6. ✅
- Rewire render client-first (mata 0/0) → Task 7. ✅
- Header/saldo client-first offline → Task 8. ✅
- Service worker shell + estáticos → Task 9. ✅
- Gating online-only Casino/Mercado/Finanzas → Task 10. ✅
- Sesión offline (ops locales sin token; sync asegura sesión) → Task 5 (`syncNow` llama `ensureAppSession`) + Task 6. ✅
- Primer uso requiere internet / aviso sin store → Task 6 (`hasData`) + Task 7 (aviso). ✅
- Testing (Vitest para lógica pura) → Tasks 1-5; E2E → Task 11. ✅
- Economía sin cambios / server reconcilia → Task 5 (usa `set_habit_status` y su `balance`). ✅

**Placeholder scan:** sin TODO/TBD. En Task 7 Step 3 se aclara borrar la línea ilustrativa `requireReward` y usar `optimisticReward` directo (no queda placeholder en el código final). ✅

**Type consistency:** `TrackerSnapshot`/`OutboxEntry` definidos en Task 2 y usados igual en 3/5/6/7/8. `optimisticReward(params)` firma consistente entre Task 1, 6 y 7. `syncNow()` y `mergePendingLogs()` consistentes entre Task 5 y 6. `useTrackerData(seed)` consistente entre 6 y 7. ✅

**Nota de ejecución:** las Tasks 1-10 las puede hacer el agente (código + unit + typecheck + build + commit). El push (Task 11 Step 2) y la verificación en Supabase requieren al usuario/deploy; el E2E offline lo puede conducir el agente con Playwright tras el deploy.
