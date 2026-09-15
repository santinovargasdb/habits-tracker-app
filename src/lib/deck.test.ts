import { describe, it, expect } from "vitest";
import { equippedMultiplierForBlock } from "./deck";
import type { Card, OwnedCard, TimeBlock } from "@/lib/types";

function card(partial: Partial<Card>): Card {
  return {
    id: partial.id ?? "c1",
    name: partial.name ?? "Carta",
    rarity: partial.rarity ?? "Common",
    target_block: partial.target_block ?? null,
    multiplier_percent: partial.multiplier_percent ?? 0,
    description: partial.description ?? "",
    image_url: partial.image_url ?? null,
  };
}
function owned(p: { id: string; is_equipped: boolean; level?: number; card: Partial<Card> }): OwnedCard {
  return { id: p.id, card: card(p.card), quantity: 1, level: p.level ?? 1, is_equipped: p.is_equipped };
}

describe("equippedMultiplierForBlock", () => {
  it("suma sólo las cartas equipadas", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { multiplier_percent: 5 } }),
      owned({ id: "b", is_equipped: false, card: { multiplier_percent: 20 } }),
      owned({ id: "c", is_equipped: true, card: { multiplier_percent: 10 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(15);
  });

  it("incluye el bonus por nivel (base + (nivel-1)*5)", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, level: 3, card: { multiplier_percent: 10 } }), // 10 + 2*5 = 20
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(20);
  });

  it("las cartas globales (target_block null) cuentan para cualquier bloque", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { target_block: null, multiplier_percent: 7 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Noche" as TimeBlock)).toBe(7);
  });

  it("una carta con target_block específico sólo cuenta para ESE bloque", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { target_block: "Tarde" as TimeBlock, multiplier_percent: 8 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(8);
    expect(equippedMultiplierForBlock(inv, "Noche" as TimeBlock)).toBe(0);
  });

  it("inventario vacío → 0", () => {
    expect(equippedMultiplierForBlock([], "Tarde" as TimeBlock)).toBe(0);
  });
});
