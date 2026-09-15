import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CARD_ART_MAP } from "./card-art-map";

const CARDS_DIR = join(process.cwd(), "public", "cards");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("CARD_ART_MAP", () => {
  it("tiene 40 entradas", () => {
    expect(CARD_ART_MAP).toHaveLength(40);
  });

  it("ids y slugs son únicos", () => {
    expect(new Set(CARD_ART_MAP.map((c) => c.id)).size).toBe(40);
    expect(new Set(CARD_ART_MAP.map((c) => c.slug)).size).toBe(40);
  });

  it("cada slug tiene su PNG válido en public/cards/", () => {
    for (const { slug } of CARD_ART_MAP) {
      const file = join(CARDS_DIR, `${slug}.png`);
      expect(existsSync(file), `falta ${slug}.png`).toBe(true);
      const head = readFileSync(file).subarray(0, 4);
      expect(head.equals(PNG_MAGIC), `${slug}.png no es PNG`).toBe(true);
    }
  });
});
