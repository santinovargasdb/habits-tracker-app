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
