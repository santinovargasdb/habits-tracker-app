// Convierte los JFIF de cofres (scripts/chest-src/*.jfif) a PNG transparentes
// en public/chests/. Saca el fondo blanco con flood-fill DESDE LOS BORDES
// (elimina solo el blanco que rodea al cofre, sin agujerear los brillos
// internos ni el glow), recorta al contenido y exporta cuadrado.
// Uso: node scripts/convert-chest-art.mjs   ·   Requiere: sharp (ya en deps).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const SRC = join(root, "scripts", "chest-src");
const OUT = join(root, "public", "chests");

// Mapeo corregido POR COLOR (el usuario había cruzado plata/oro):
//   silver.jfif  = cofre plateado  → silver.png
//   gold.jfif    = cofre dorado    → gold.png
//   magical.jfif = cofre violeta   → magical.png
const TIERS = ["silver", "gold", "magical"];

// Un pixel es "fondo" si es casi blanco Y de baja saturación. El chequeo de
// saturación evita comerse el glow amarillo (R,G altos, B bajo => saturado).
const WHITE_MIN = 232; // min(R,G,B) por encima de esto…
const SAT_TOL = 16; //    …y (max-min) por debajo de esto => blanco de fondo.
const SIZE = 256; // lienzo cuadrado final
const MARGIN = 0.06; // aire alrededor del cofre

async function convert(tier) {
  const inPath = join(SRC, `${tier}.jfif`);
  const outPath = join(OUT, `${tier}.png`);

  const { data, info } = await sharp(inPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const isWhiteish = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= WHITE_MIN && mx - mn <= SAT_TOL;
  };

  const bg = new Uint8Array(width * height);
  const stack = [];
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (bg[p]) return;
    if (!isWhiteish(p * channels)) return;
    bg[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
  }

  // Alpha 0 al fondo; bounding box del cofre (foreground).
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (bg[p]) {
        data[p * channels + 3] = 0;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${tier}: no quedó foreground (¿umbral muy alto?)`);

  const fgW = maxX - minX + 1, fgH = maxY - minY + 1;
  const inner = Math.round(SIZE * (1 - 2 * MARGIN));

  // Recorto al cofre, escalo dentro del lienzo, y centro con padding transparente.
  const fitted = await sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: fgW, height: fgH })
    .resize(inner, inner, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const m = await sharp(fitted).metadata();
  const padX = Math.floor((SIZE - m.width) / 2);
  const padY = Math.floor((SIZE - m.height) / 2);

  await sharp(fitted)
    .extend({
      top: padY, bottom: SIZE - m.height - padY,
      left: padX, right: SIZE - m.width - padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPath);

  const removed = bg.reduce((a, v) => a + v, 0);
  const pct = ((removed / (width * height)) * 100).toFixed(1);
  console.log(`✓ ${tier}.png  (${width}x${height} → ${SIZE}x${SIZE}, fondo removido ${pct}%)`);
}

mkdirSync(OUT, { recursive: true });
for (const tier of TIERS) await convert(tier);
console.log("Listo: public/chests/{silver,gold,magical}.png");
