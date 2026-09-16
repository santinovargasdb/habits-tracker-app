import type { Habit, TimeBlock } from "@/lib/types";
import { TIME_BLOCK_ORDER, normalizeTimeBlock } from "@/lib/constants";
import { weekStartISO } from "@/lib/utils";

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

/** Semanas (columnas) que muestra el heatmap estilo GitHub. */
export const SEMANAS_HEATMAP = 26;

/** Lunes de arranque de la grilla: SEMANAS_HEATMAP semanas atrás (incluida la actual). */
export function heatmapDesdeISO(hoyISO: string): string {
  return addDaysISO(weekStartISO(hoyISO), -(SEMANAS_HEATMAP - 1) * 7);
}

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
  general: {
    /** Grilla estilo GitHub: semanas[col] = una semana (7 celdas lun→dom). Nivel 0-4, o null si el día es futuro. */
    semanas: (number | null)[][];
    rachaActual: number;
    mejorRacha: number;
    diasActivos: number;
  };
  etapas: Record<TimeBlock, { tareas: BlockTask[] }>;
  tareaEstrella: { nombre: string; hechos: number } | null;
}

export function summarizeActivity(
  rows: ActivityRow[],
  habits: Habit[],
  hoyISO: string,
): ActivitySummary {
  const desde = heatmapDesdeISO(hoyISO); // lunes de arranque de la grilla (26 semanas atrás)

  // Set de fechas activas y conteo por fecha (nº de tareas hechas ese día).
  const activos = new Set<string>();
  const countPorFecha = new Map<string, number>();
  const done = new Set<string>(); // `${habit_id}|${fecha}`
  for (const r of rows) {
    activos.add(r.log_date);
    countPorFecha.set(r.log_date, (countPorFecha.get(r.log_date) ?? 0) + 1);
    done.add(`${r.habit_id}|${r.log_date}`);
  }

  // Heatmap estilo GitHub: SEMANAS_HEATMAP columnas (semanas) × 7 filas (lun→dom).
  // Cada celda = nivel 0-4; null si el día es futuro (posterior a hoy).
  const semanas: (number | null)[][] = [];
  for (let w = 0; w < SEMANAS_HEATMAP; w++) {
    const lunSemana = addDaysISO(desde, w * 7);
    const semana: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const dia = addDaysISO(lunSemana, d);
      semana.push(dia > hoyISO ? null : bucketNivel(countPorFecha.get(dia) ?? 0));
    }
    semanas.push(semana);
  }

  const general = {
    semanas,
    rachaActual: computeStreak(activos, hoyISO),
    mejorRacha: mejorRachaEnVentana(activos, desde, hoyISO),
    diasActivos: [...activos].filter((d) => d >= desde && d <= hoyISO).length,
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
