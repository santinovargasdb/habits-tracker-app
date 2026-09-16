import { describe, it, expect } from "vitest";
import { addDaysISO, rangeISO, bucketNivel, computeStreak, mejorRachaEnVentana, summarizeActivity, type ActivityRow } from "./activity";
import type { Habit } from "@/lib/types";

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
    // grilla estilo GitHub: 26 columnas (semanas) × 7 filas (lun→dom)
    expect(s.general.semanas).toHaveLength(26);
    expect(s.general.semanas.every((w) => w.length === 7)).toBe(true);
    // semana actual = última columna (lun14..dom20): vie18=2, sab19=1, dom20=2, resto 0
    expect(s.general.semanas[25]).toEqual([0, 0, 0, 0, 2, 1, 2]);
  });

  it("grilla general: días futuros de la semana en curso son null", () => {
    // hoy = miércoles 2026-09-16; semana lun14..dom20; jue17..dom20 son futuros.
    const s = summarizeActivity([], habits, "2026-09-16");
    expect(s.general.semanas[25]).toEqual([0, 0, 0, null, null, null, null]);
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
