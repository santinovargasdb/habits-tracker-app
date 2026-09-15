import { describe, it, expect } from "vitest";
import { rowToCard } from "./cards";

describe("rowToCard", () => {
  it("usa multiplier_percent entero cuando existe (>0)", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", target_block: null, multiplier_percent: 10, multiplier: "1.10", icon_url: "/cards/wizard.png" });
    expect(c.multiplier_percent).toBe(10);
  });

  it("prioriza icon_url sobre image_url para el arte", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", icon_url: "/cards/wizard.png", image_url: "/otro.png" });
    expect(c.image_url).toBe("/cards/wizard.png");
  });

  it("cae a image_url si no hay icon_url", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", icon_url: null, image_url: "/cards/wizard.png" });
    expect(c.image_url).toBe("/cards/wizard.png");
  });

  it("target_block null cuando falta", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare" });
    expect(c.target_block).toBeNull();
    expect(c.multiplier_percent).toBe(0);
  });
});
