import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CHEST_TIERS } from "./constants";

const CHESTS_DIR = join(process.cwd(), "public", "chests");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("CHEST_TIERS arte local", () => {
  it("los 3 tiers tienen imagen /chests/<tier>.png", () => {
    for (const tier of CHEST_TIERS) {
      expect(tier.image, `${tier.tier} sin image`).toBe(`/chests/${tier.tier}.png`);
    }
  });

  it("cada image apunta a un PNG válido en public/chests/", () => {
    for (const { tier, image } of CHEST_TIERS) {
      if (!image) continue;
      const file = join(CHESTS_DIR, `${tier}.png`);
      expect(existsSync(file), `falta ${tier}.png`).toBe(true);
      const head = readFileSync(file).subarray(0, 4);
      expect(head.equals(PNG_MAGIC), `${tier}.png no es PNG`).toBe(true);
    }
  });
});
