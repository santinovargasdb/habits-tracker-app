// Descarga las 40 PNG de arte a public/cards/. Uso: node scripts/fetch-card-art.mjs
// Requiere red (CDN de RoyaleAPI). Node 20+ (fetch global).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const OUT = join(root, "public", "cards");
const BASE = "https://cdn.royaleapi.com/static/img/cards-150/";

// Parseamos los slugs del mapa TS sin transpilar (regex sobre slug: "...").
const mapSrc = readFileSync(join(root, "src", "lib", "card-art-map.ts"), "utf8");
const slugs = [...mapSrc.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
if (slugs.length !== 40) throw new Error(`Esperaba 40 slugs, encontré ${slugs.length}`);

mkdirSync(OUT, { recursive: true });
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let ok = 0;
for (const slug of slugs) {
  const dest = join(OUT, `${slug}.png`);
  if (existsSync(dest)) { ok++; continue; }
  const res = await fetch(BASE + `${slug}.png`);
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) throw new Error(`${slug}: no es PNG`);
  writeFileSync(dest, buf);
  ok++;
  console.log(`✓ ${slug}.png (${buf.length} bytes)`);
}
console.log(`Listo: ${ok}/40 en public/cards/`);
