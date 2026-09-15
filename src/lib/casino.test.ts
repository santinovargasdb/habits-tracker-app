import { describe, it, expect } from "vitest";
import { minesMultiplier, chickenMultiplier } from "./casino";

describe("minesMultiplier", () => {
  it("k=0 siempre da 1", () => {
    expect(minesMultiplier(3, 0)).toBe(1);
    expect(minesMultiplier(10, 0)).toBe(1);
  });
  it("valores de referencia (3/5/10 minas)", () => {
    expect(minesMultiplier(3, 1)).toBe(1.1);
    expect(minesMultiplier(3, 2)).toBe(1.26);
    expect(minesMultiplier(3, 3)).toBe(1.45);
    expect(minesMultiplier(5, 1)).toBe(1.21);
    expect(minesMultiplier(5, 2)).toBe(1.53);
    expect(minesMultiplier(5, 3)).toBe(1.96);
    expect(minesMultiplier(10, 1)).toBe(1.62);
    expect(minesMultiplier(10, 2)).toBe(2.77);
    expect(minesMultiplier(10, 3)).toBe(4.9);
  });
  it("más minas paga más en la misma casilla", () => {
    expect(minesMultiplier(10, 1)).toBeGreaterThan(minesMultiplier(3, 1));
  });
});

describe("chickenMultiplier", () => {
  it("lane 0 da 1", () => {
    expect(chickenMultiplier(0)).toBe(1);
  });
  it("valores de referencia", () => {
    expect(chickenMultiplier(1)).toBe(1.29);
    expect(chickenMultiplier(2)).toBe(1.72);
    expect(chickenMultiplier(3)).toBe(2.3);
    expect(chickenMultiplier(5)).toBe(4.09);
    expect(chickenMultiplier(8)).toBe(9.69);
    expect(chickenMultiplier(20)).toBe(305.88);
  });
});
