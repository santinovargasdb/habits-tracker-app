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
