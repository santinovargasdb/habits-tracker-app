# Heatmap de días activos + racha — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar arriba del Tracker la racha de días consecutivos + un heatmap de días activos, con una hoja desplegable de 5 heatmaps (general + 4 etapas con grid tarea×día) e info de racha.

**Architecture:** Un RPC read-only `activity_log(date)` devuelve `(habit_id, log_date, status)` de los últimos 30 días. Toda la lógica de racha/intensidad se calcula en el cliente con funciones **puras y testeadas** (`src/lib/activity.ts`), usando la **fecha local** del navegador. La UI son componentes chicos (`DayStrip`, `TaskGrid`, `ActivitySheet`, `ActivityBar`) montados en `TrackerView`. No toca la economía.

**Tech Stack:** Next.js (custom), React 19, TypeScript, Supabase (Postgres RPC), Tailwind, Vitest (jsdom, funciones puras).

## Global Constraints

- **Solo lectura:** no se modifica `logs`/`habits`/`wallet` ni ninguna función de economía. El único objeto SQL nuevo es la función `activity_log(date)`.
- **Fecha local:** todo cálculo de fechas/racha usa `todayISO()` (local) y se pasa al RPC como `p_from`. Nunca usar la fecha del server para "hoy".
- **Ventanas:** heatmap general = **30 días** (`hoy` y los 29 anteriores). Grids por tarea = **semana en curso** (lunes→domingo, `weekStartISO`); días futuros vacíos.
- **Racha:** global (no por etapa). `rachaActual` con gracia del día en curso. `mejorRacha` = mejor corrida dentro de la ventana de 30 días.
- **Intensidad:** niveles `0,1,2,3,4+` según cantidad de tareas hechas ese día.
- **Etapas:** las 4 de `TIME_BLOCK_ORDER`, mapeando `time_block` con `normalizeTimeBlock`. Un bloque fuera de las 4 va solo al agregado general.
- **TDD** en `src/lib/activity.ts`. Componentes: sin unit test (el repo no tiene testing-library) → se verifican con `npx tsc --noEmit`, `npx eslint <archivos>` y `npx next build`.
- **Prod:** la migración 23 es un **paso manual** en Supabase (read-only).
- **Commits:** incrementales por tarea (`feat(activity): …` / `test(activity): …`). La feature completa corresponde al **Paso 23**. Trailer en cada commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Helpers de fecha + intensidad (puros)

**Files:**
- Create: `src/lib/activity.ts`
- Test: `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `addDaysISO(iso: string, n: number): string` — suma `n` días (puede ser negativo) a una fecha `YYYY-MM-DD`, en horario local.
  - `rangeISO(fromISO: string, toISO: string): string[]` — lista inclusiva de fechas `YYYY-MM-DD` de `from` a `to`.
  - `bucketNivel(count: number): number` — 0→0, 1→1, 2→2, 3→3, ≥4→4.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/activity.test.ts
import { describe, it, expect } from "vitest";
import { addDaysISO, rangeISO, bucketNivel } from "./activity";

describe("helpers de fecha", () => {
  it("addDaysISO suma y resta días", () => {
    expect(addDaysISO("2026-09-16", 1)).toBe("2026-09-17");
    expect(addDaysISO("2026-09-16", -29)).toBe("2026-08-18");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("rangeISO es inclusivo y ordenado", () => {
    expect(rangeISO("2026-09-14", "2026-09-16")).toEqual([
      "2026-09-14", "2026-09-15", "2026-09-16",
    ]);
    expect(rangeISO("2026-09-16", "2026-09-16")).toEqual(["2026-09-16"]);
  });
});

describe("bucketNivel", () => {
  it("mapea 0..4+", () => {
    expect([0, 1, 2, 3, 4, 7].map(bucketNivel)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: FAIL — "does not provide an export named 'addDaysISO'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/activity.ts
// Toda fecha es un string local YYYY-MM-DD. Parseamos con T00:00:00 (local).
function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function rangeISO(fromISO: string, toISO_: string): string[] {
  const out: string[] = [];
  let cur = fromISO;
  while (cur <= toISO_) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export function bucketNivel(count: number): number {
  if (count <= 0) return 0;
  return Math.min(count, 4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "test(activity): helpers de fecha + intensidad"
```

---

### Task 2: Cálculo de racha (puro)

**Files:**
- Modify: `src/lib/activity.ts`
- Test: `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: `addDaysISO`, `rangeISO` (Task 1).
- Produces:
  - `computeStreak(activos: Set<string>, hoyISO: string): number` — días consecutivos activos terminando hoy; si hoy no está activo pero ayer sí, cuenta hasta ayer (gracia); si ni hoy ni ayer, 0.
  - `mejorRachaEnVentana(activos: Set<string>, desdeISO: string, hastaISO: string): number` — corrida activa más larga en `[desde, hasta]`.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a src/lib/activity.test.ts
import { computeStreak, mejorRachaEnVentana } from "./activity";

describe("computeStreak (con gracia)", () => {
  const set = (xs: string[]) => new Set(xs);
  it("cuenta consecutivos terminando hoy", () => {
    expect(computeStreak(set(["2026-09-14", "2026-09-15", "2026-09-16"]), "2026-09-16")).toBe(3);
  });
  it("gracia: hoy sin actividad pero ayer sí → cuenta hasta ayer", () => {
    expect(computeStreak(set(["2026-09-14", "2026-09-15"]), "2026-09-16")).toBe(2);
  });
  it("se corta si falta un día", () => {
    expect(computeStreak(set(["2026-09-13", "2026-09-16"]), "2026-09-16")).toBe(1);
  });
  it("ni hoy ni ayer → 0", () => {
    expect(computeStreak(set(["2026-09-10"]), "2026-09-16")).toBe(0);
    expect(computeStreak(set([]), "2026-09-16")).toBe(0);
  });
});

describe("mejorRachaEnVentana", () => {
  it("toma la corrida más larga", () => {
    const activos = new Set(["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(mejorRachaEnVentana(activos, "2026-09-01", "2026-09-07")).toBe(3);
  });
  it("sin actividad → 0", () => {
    expect(mejorRachaEnVentana(new Set(), "2026-09-01", "2026-09-07")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: FAIL — "does not provide an export named 'computeStreak'".

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a src/lib/activity.ts
export function computeStreak(activos: Set<string>, hoyISO: string): number {
  let anchor = hoyISO;
  if (!activos.has(anchor)) {
    const ayer = addDaysISO(hoyISO, -1);
    if (activos.has(ayer)) anchor = ayer;
    else return 0;
  }
  let n = 0;
  let d = anchor;
  while (activos.has(d)) {
    n++;
    d = addDaysISO(d, -1);
  }
  return n;
}

export function mejorRachaEnVentana(
  activos: Set<string>,
  desdeISO: string,
  hastaISO: string,
): number {
  let best = 0;
  let run = 0;
  for (const d of rangeISO(desdeISO, hastaISO)) {
    if (activos.has(d)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "test(activity): calculo de racha actual y mejor"
```

---

### Task 3: `summarizeActivity` (compone todo)

**Files:**
- Modify: `src/lib/activity.ts`
- Test: `src/lib/activity.test.ts`

**Interfaces:**
- Consumes: `addDaysISO`, `rangeISO`, `bucketNivel`, `computeStreak`, `mejorRachaEnVentana` (Tasks 1-2); `Habit`, `TimeBlock` de `@/lib/types`; `TIME_BLOCK_ORDER`, `normalizeTimeBlock` de `@/lib/constants`; `weekStartISO` de `@/lib/utils`.
- Produces:
  - `interface ActivityRow { habit_id: string; log_date: string; status: string }`
  - `interface BlockTask { id: string; nombre: string; semana: (boolean | null)[] }`
  - `interface ActivitySummary { general: { niveles30: number[]; rachaActual: number; mejorRacha: number; diasActivos: number }; etapas: Record<TimeBlock, { tareas: BlockTask[] }>; tareaEstrella: { nombre: string; hechos: number } | null }`
  - `summarizeActivity(rows: ActivityRow[], habits: Habit[], hoyISO: string): ActivitySummary`

- [ ] **Step 1: Write the failing test**

```ts
// añadir a src/lib/activity.test.ts
import { summarizeActivity, type ActivityRow } from "./activity";
import type { Habit } from "@/lib/types";

const habit = (id: string, name: string, block: Habit["time_block"]): Habit => ({
  id, name, time_block: block, sort_order: 0, frequency: "daily", multiplier: 1,
});

describe("summarizeActivity", () => {
  // hoy = domingo 2026-09-20; semana en curso = lun 14 → dom 20.
  const hoy = "2026-09-20";
  const habits: Habit[] = [
    habit("h1", "Meditar", "Tarde"),
    habit("h2", "Entrenar", "Tarde"),
    habit("h3", "Podcast", "Viaje"),
  ];
  const rows: ActivityRow[] = [
    { habit_id: "h1", log_date: "2026-09-18", status: "MET" },
    { habit_id: "h2", log_date: "2026-09-18", status: "MET" },
    { habit_id: "h1", log_date: "2026-09-19", status: "SURPASSED" },
    { habit_id: "h1", log_date: "2026-09-20", status: "MET" },
    { habit_id: "h3", log_date: "2026-09-20", status: "MET" },
  ];

  it("racha, mejor y días activos (global)", () => {
    const s = summarizeActivity(rows, habits, hoy);
    // activos: 18, 19, 20 → racha 3, mejor 3, diasActivos 3
    expect(s.general.rachaActual).toBe(3);
    expect(s.general.mejorRacha).toBe(3);
    expect(s.general.diasActivos).toBe(3);
    expect(s.general.niveles30).toHaveLength(30);
    // último día (hoy) tuvo 2 tareas → nivel 2
    expect(s.general.niveles30[29]).toBe(2);
  });

  it("grids por etapa: 7 celdas lun→dom, futuros null", () => {
    const s = summarizeActivity(rows, habits, hoy);
    const tarde = s.etapas.Tarde.tareas;
    expect(tarde.map((t) => t.nombre)).toEqual(["Meditar", "Entrenar"]);
    // Meditar (h1): jue18 T, vie19 T, dom20 T → semana [L..D] = lun14..dom20
    // idx: 0=lun14 1=mar15 2=mie16 3=jue17 4=vie18? -> ojo: 14 lun,15 mar,16 mie,17 jue,18 vie,19 sab,20 dom
    const meditar = tarde[0].semana;
    expect(meditar).toEqual([false, false, false, false, true, true, true]);
    // Viaje: Podcast (h3) solo dom20
    expect(s.etapas.Viaje.tareas[0].semana[6]).toBe(true);
  });

  it("tarea estrella de la semana", () => {
    const s = summarizeActivity(rows, habits, hoy);
    // h1 hecho 3 veces esta semana (18,19,20) → estrella
    expect(s.tareaEstrella).toEqual({ nombre: "Meditar", hechos: 3 });
  });

  it("historial vacío", () => {
    const s = summarizeActivity([], habits, hoy);
    expect(s.general.rachaActual).toBe(0);
    expect(s.tareaEstrella).toBeNull();
    expect(s.etapas.Tarde.tareas[0].semana.every((c) => c === false || c === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: FAIL — "does not provide an export named 'summarizeActivity'".

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a src/lib/activity.ts (imports arriba del archivo)
import type { Habit, TimeBlock } from "@/lib/types";
import { TIME_BLOCK_ORDER, normalizeTimeBlock } from "@/lib/constants";
import { weekStartISO } from "@/lib/utils";

export interface ActivityRow {
  habit_id: string;
  log_date: string;
  status: string;
}
export interface BlockTask {
  id: string;
  nombre: string;
  semana: (boolean | null)[];
}
export interface ActivitySummary {
  general: { niveles30: number[]; rachaActual: number; mejorRacha: number; diasActivos: number };
  etapas: Record<TimeBlock, { tareas: BlockTask[] }>;
  tareaEstrella: { nombre: string; hechos: number } | null;
}

export function summarizeActivity(
  rows: ActivityRow[],
  habits: Habit[],
  hoyISO: string,
): ActivitySummary {
  const desde30 = addDaysISO(hoyISO, -29);

  // Set de fechas activas y conteo por fecha (nº de tareas hechas ese día).
  const activos = new Set<string>();
  const countPorFecha = new Map<string, number>();
  const done = new Set<string>(); // `${habit_id}|${fecha}`
  for (const r of rows) {
    activos.add(r.log_date);
    countPorFecha.set(r.log_date, (countPorFecha.get(r.log_date) ?? 0) + 1);
    done.add(`${r.habit_id}|${r.log_date}`);
  }

  const niveles30 = rangeISO(desde30, hoyISO).map((d) => bucketNivel(countPorFecha.get(d) ?? 0));
  const general = {
    niveles30,
    rachaActual: computeStreak(activos, hoyISO),
    mejorRacha: mejorRachaEnVentana(activos, desde30, hoyISO),
    diasActivos: activos.size,
  };

  // Semana en curso: lunes → domingo (7 días).
  const lunes = weekStartISO(hoyISO);
  const semanaDias = rangeISO(lunes, addDaysISO(lunes, 6));

  const etapas = {} as Record<TimeBlock, { tareas: BlockTask[] }>;
  for (const block of TIME_BLOCK_ORDER) {
    const tareas = habits
      .filter((h) => normalizeTimeBlock(h.time_block) === block)
      .map<BlockTask>((h) => ({
        id: h.id,
        nombre: h.name,
        semana: semanaDias.map((d) => (d > hoyISO ? null : done.has(`${h.id}|${d}`))),
      }));
    etapas[block] = { tareas };
  }

  // Tarea estrella de la semana: más completados en la semana en curso.
  let tareaEstrella: { nombre: string; hechos: number } | null = null;
  for (const h of habits) {
    const hechos = semanaDias.reduce((acc, d) => acc + (done.has(`${h.id}|${d}`) ? 1 : 0), 0);
    if (hechos > 0 && (!tareaEstrella || hechos > tareaEstrella.hechos)) {
      tareaEstrella = { nombre: h.name, hechos };
    }
  }

  return { general, etapas, tareaEstrella };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "test(activity): summarizeActivity (general + etapas + estrella)"
```

---

### Task 4: Migración RPC `activity_log` (prod manual)

**Files:**
- Create: `supabase/23_activity_log.sql`

**Interfaces:**
- Produces: función SQL `public.activity_log(p_from date)` → `table(habit_id uuid, log_date date, status text)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/23_activity_log.sql
-- =============================================================================
-- Dojo Ledger — Paso 23: RPC read-only de actividad (heatmap + racha)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql (tabla logs) y habits. Es SOLO LECTURA (no toca saldo).
-- =============================================================================

create or replace function public.activity_log(p_from date)
returns table (habit_id uuid, log_date date, status text)
language sql security definer set search_path = public stable as $$
  select l.habit_id, l.date, l.status::text
  from public.logs l
  join public.habits h on h.id = l.habit_id
  where h.user_id = auth.uid()
    and l.date >= p_from
    and l.status in ('MET', 'SURPASSED');
$$;

grant execute on function public.activity_log(date) to authenticated;
revoke execute on function public.activity_log(date) from anon;
-- VERIFICACIÓN (aparte, desde la app con sesión): debería devolver filas del último mes.
-- FIN Paso 23.
```

- [ ] **Step 2: Verificar sintaxis localmente (lint del archivo)**

Run: `node -e "const s=require('fs').readFileSync('supabase/23_activity_log.sql','utf8'); if(!/create or replace function public\.activity_log/.test(s)) throw new Error('falta la función'); console.log('OK migración 23')"`
Expected: `OK migración 23`.

- [ ] **Step 3: Commit**

```bash
git add supabase/23_activity_log.sql
git commit -m "feat(activity): migracion 23 - RPC read-only activity_log"
```

- [ ] **Step 4: Aplicar en prod (manual)**

Pegar el contenido de `supabase/23_activity_log.sql` en Supabase → SQL Editor → Run.
Nota: `auth.uid()` es NULL desde el SQL Editor, así que verificar el resultado **desde la app** (Task 10), no con un `select` suelto en el editor.

---

### Task 5: Server action `fetchActivity`

**Files:**
- Create: `src/actions/activity.ts`

**Interfaces:**
- Consumes: `getSupabaseOrThrow` de `@/lib/supabase/server`; `ActivityRow` de `@/lib/activity`; RPC `activity_log` (Task 4).
- Produces: `fetchActivity(pFrom: string): Promise<ActivityRow[]>`.

- [ ] **Step 1: Escribir el action**

```ts
// src/actions/activity.ts
"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import type { ActivityRow } from "@/lib/activity";

/** Trae los logs (MET/SURPASSED) del usuario desde pFrom (YYYY-MM-DD). Read-only. */
export async function fetchActivity(pFrom: string): Promise<ActivityRow[]> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc("activity_log", { p_from: pFrom });
  if (error) {
    console.error("[fetchActivity] RPC error:", error.message);
    return [];
  }
  return (data ?? []) as ActivityRow[];
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (sin errores).

- [ ] **Step 3: Commit**

```bash
git add src/actions/activity.ts
git commit -m "feat(activity): server action fetchActivity"
```

---

### Task 6: Componente `DayStrip` (heatmap general)

**Files:**
- Create: `src/components/day-strip.tsx`

**Interfaces:**
- Consumes: `cn` de `@/lib/utils`.
- Produces: `DayStrip({ niveles, className }: { niveles: number[]; className?: string })`.

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/day-strip.tsx
import { cn } from "@/lib/utils";

// Rampa de intensidad 0..4 (estilo "contribution graph"), por hex para no
// depender de la paleta de Tailwind.
const NIVEL_COLOR = ["#20262e", "#0e4429", "#006d32", "#26a641", "#39d353"];

export function DayStrip({ niveles, className }: { niveles: number[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-[3px]", className)}>
      {niveles.map((n, i) => (
        <span
          key={i}
          aria-hidden
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: NIVEL_COLOR[Math.max(0, Math.min(4, n))] }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/day-strip.tsx`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/day-strip.tsx
git commit -m "feat(activity): componente DayStrip (heatmap agregado)"
```

---

### Task 7: Componente `TaskGrid` (grid tarea × día)

**Files:**
- Create: `src/components/task-grid.tsx`

**Interfaces:**
- Consumes: `BlockTask` de `@/lib/activity`; `TIME_BLOCK_META` de `@/lib/constants`; `TimeBlock` de `@/lib/types`; `cn` de `@/lib/utils`.
- Produces: `TaskGrid({ block, tareas }: { block: TimeBlock; tareas: BlockTask[] })`.

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/task-grid.tsx
import { TIME_BLOCK_META } from "@/lib/constants";
import type { TimeBlock } from "@/lib/types";
import type { BlockTask } from "@/lib/activity";

const DIAS = ["L", "M", "X", "J", "V", "S", "D"];

export function TaskGrid({ block, tareas }: { block: TimeBlock; tareas: BlockTask[] }) {
  const meta = TIME_BLOCK_META[block];
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span aria-hidden>{meta.icon}</span>
        <h3 className="font-display text-sm font-bold uppercase tracking-wide" style={{ color: meta.accent }}>
          {meta.label}
        </h3>
      </div>

      {tareas.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">Sin tareas en esta etapa.</p>
      ) : (
        <div className="space-y-1">
          {/* Encabezado de días */}
          <div className="flex items-center gap-1 pl-[40%]">
            {DIAS.map((d) => (
              <span key={d} className="w-4 text-center font-mono text-[9px] text-muted">
                {d}
              </span>
            ))}
          </div>
          {tareas.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <span className="w-[40%] truncate pr-1 text-[12px] text-fg">{t.nombre}</span>
              {t.semana.map((cell, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="grid h-4 w-4 place-items-center rounded-[3px] text-[10px]"
                  style={{
                    backgroundColor:
                      cell === true ? `${meta.accent}33` : cell === false ? "#20262e" : "transparent",
                    color: meta.accent,
                    border: cell === null ? "1px dashed #2a3038" : "none",
                  }}
                >
                  {cell === true ? "✕" : cell === false ? "·" : ""}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/task-grid.tsx`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/task-grid.tsx
git commit -m "feat(activity): componente TaskGrid (tarea x dia)"
```

---

### Task 8: Componente `ActivitySheet` (la hoja)

**Files:**
- Create: `src/components/activity-sheet.tsx`

**Interfaces:**
- Consumes: `ActivitySummary` de `@/lib/activity`; `TIME_BLOCK_ORDER` de `@/lib/constants`; `DayStrip` (Task 6); `TaskGrid` (Task 7); `createPortal` de `react-dom`.
- Produces: `ActivitySheet({ summary, onClose }: { summary: ActivitySummary; onClose: () => void })`.

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/activity-sheet.tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TIME_BLOCK_ORDER } from "@/lib/constants";
import type { ActivitySummary } from "@/lib/activity";
import { DayStrip } from "@/components/day-strip";
import { TaskGrid } from "@/components/task-grid";

export function ActivitySheet({
  summary,
  onClose,
}: {
  summary: ActivitySummary;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  // Guard de montaje en cliente para createPortal (patrón del proyecto).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  const g = summary.general;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center">
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div className="animate-rise relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 pb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-fg">Tu actividad</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* General */}
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          General · últimos 30 días
        </p>
        <DayStrip niveles={g.niveles30} className="mb-4" />

        {/* Etapas */}
        {TIME_BLOCK_ORDER.map((block) => (
          <TaskGrid key={block} block={block} tareas={summary.etapas[block].tareas} />
        ))}

        {/* Info de racha */}
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm text-fg">
          <p>🔥 Racha actual: <b>{g.rachaActual}</b> días · mejor (30d): <b>{g.mejorRacha}</b></p>
          <p className="text-muted">📊 {g.diasActivos} días activos (últimos 30)</p>
          {summary.tareaEstrella && (
            <p className="text-gold">
              ⭐ Tarea estrella de la semana: «{summary.tareaEstrella.nombre}» ({summary.tareaEstrella.hechos} días)
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/activity-sheet.tsx`
Expected: exit 0. (Si eslint marca `animate-rise`/`animate-fade-in` inexistentes no aplica — son clases del proyecto; si no existieran, quitar la clase de animación.)

- [ ] **Step 3: Commit**

```bash
git add src/components/activity-sheet.tsx
git commit -m "feat(activity): ActivitySheet (hoja con 5 heatmaps + info)"
```

---

### Task 9: Componente `ActivityBar` (barra colapsada + fetch)

**Files:**
- Create: `src/components/activity-bar.tsx`

**Interfaces:**
- Consumes: `Habit` de `@/lib/types`; `fetchActivity` (Task 5); `summarizeActivity`, `addDaysISO`, `ActivitySummary` de `@/lib/activity`; `DayStrip` (Task 6); `ActivitySheet` (Task 8).
- Produces: `ActivityBar({ habits, today }: { habits: Habit[]; today: string })` (default export).

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/activity-bar.tsx
"use client";

import { useEffect, useState } from "react";
import type { Habit } from "@/lib/types";
import { fetchActivity } from "@/actions/activity";
import { addDaysISO, summarizeActivity, type ActivitySummary } from "@/lib/activity";
import { DayStrip } from "@/components/day-strip";
import { ActivitySheet } from "@/components/activity-sheet";

export default function ActivityBar({ habits, today }: { habits: Habit[]; today: string }) {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchActivity(addDaysISO(today, -29));
      if (alive) setSummary(summarizeActivity(rows, habits, today));
    })();
    return () => {
      alive = false;
    };
  }, [today, habits]);

  const racha = summary?.general.rachaActual ?? 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!summary}
        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3 text-left disabled:opacity-60"
        aria-label="Ver detalle de actividad"
      >
        <span className="font-display text-lg font-extrabold text-fg whitespace-nowrap">
          🔥 {racha} {racha === 1 ? "día" : "días"}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          {summary ? (
            <DayStrip niveles={summary.general.niveles30} />
          ) : (
            <span className="font-mono text-[11px] text-muted">Cargando…</span>
          )}
        </span>
        <span aria-hidden className="text-muted">›</span>
      </button>

      {open && summary && <ActivitySheet summary={summary} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/activity-bar.tsx`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/activity-bar.tsx
git commit -m "feat(activity): ActivityBar (barra colapsada + fetch)"
```

---

### Task 10: Montar en `TrackerView` + integración final

**Files:**
- Modify: `src/components/tracker-view.tsx`

**Interfaces:**
- Consumes: `ActivityBar` (Task 9); `habits` y `date` que ya expone `useTrackerData` dentro de `TrackerView`.

- [ ] **Step 1: Importar el componente**

En `src/components/tracker-view.tsx`, junto a los imports de componentes, agregar:

```tsx
import ActivityBar from "@/components/activity-bar";
```

- [ ] **Step 2: Montar la barra arriba del contenido**

En el `return (` de `TrackerView`, insertar la barra como primer hijo del contenedor principal, usando los valores ya disponibles `habits` y `date` (de `useTrackerData(seed)`). Ejemplo (ajustar al contenedor real):

```tsx
      {/* Racha + heatmap de actividad */}
      {habits.length > 0 && <ActivityBar habits={habits} today={date} />}
```

- [ ] **Step 3: Typecheck, lint, tests y build**

Run: `npx tsc --noEmit && npx eslint src/components/tracker-view.tsx src/components/activity-bar.tsx && npx vitest run && npx next build`
Expected: tsc exit 0; eslint exit 0; todos los tests PASS (incluye `activity.test.ts`); build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/tracker-view.tsx
git commit -m "feat(activity): montar ActivityBar arriba del Tracker (Paso 23)"
```

- [ ] **Step 5: Aplicar migración en prod y verificar en la app**

1. Correr `supabase/23_activity_log.sql` en Supabase → SQL Editor (si no se hizo en Task 4).
2. Con el deploy actualizado, abrir el Tracker: debe verse la barra con la racha y la tira; al tocar, la hoja con el heatmap general + las 4 etapas (grid tarea×día de la semana) + la info de racha y tarea estrella.
3. Marcar/desmarcar un hábito y confirmar que la actividad del día se refleja (tras recargar).

- [ ] **Step 6: Push**

```bash
git push origin master
```

---

## Self-Review (hecho)

- **Cobertura del spec:** RPC read-only (Task 4) · lógica pura racha/intensidad/etapas/estrella (Tasks 1-3, testeada) · fecha local (`today` de `todayISO`, `addDaysISO`) · ventanas 30d/semana (Tasks 3,8,9) · 5 heatmaps: general (DayStrip, Tasks 6/8) + 4 etapas (TaskGrid, Tasks 7/8) · info de racha + tarea estrella (Task 8) · barra colapsada que abre la hoja (Task 9) · montaje arriba del Tracker (Task 10) · sin tocar economía (ningún task modifica wallet/set_habit_status) · paso manual en prod (Tasks 4/10).
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** `ActivityRow`/`BlockTask`/`ActivitySummary` definidos en Task 3 y consumidos con las mismas firmas en Tasks 5-9. `summarizeActivity(rows, habits, hoyISO)`, `fetchActivity(pFrom)`, `DayStrip({niveles})`, `TaskGrid({block, tareas})`, `ActivitySheet({summary, onClose})`, `ActivityBar({habits, today})` coinciden entre productor y consumidor.
