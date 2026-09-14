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
