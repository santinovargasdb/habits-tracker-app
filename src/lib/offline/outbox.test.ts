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

  it("mantiene entradas de distintos (habitId, logDate) y remove sólo saca una", () => {
    outbox.enqueue({ habitId: "h1", logDate: "2026-09-14", status: "MET", updatedAt: 1 });
    outbox.enqueue({ habitId: "h2", logDate: "2026-09-14", status: "MET", updatedAt: 1 });
    outbox.enqueue({ habitId: "h1", logDate: "2026-09-08", status: "SURPASSED", updatedAt: 1 });
    expect(outbox.all()).toHaveLength(3);

    outbox.remove("h1", "2026-09-14");
    const rest = outbox
      .all()
      .map((e) => `${e.habitId}:${e.logDate}`)
      .sort();
    expect(rest).toEqual(["h1:2026-09-08", "h2:2026-09-14"]);
  });
});
