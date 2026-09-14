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
