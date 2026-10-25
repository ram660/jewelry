// Draws every code-made backdrop and a contact sheet with a real-pixel ring on each, so they can be judged by eye.
//   node scripts/backdrops-preview.mts [output-folder]
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (/^[.][.]?[/]/.test(s) && !/[.]\\w+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
}`),
  import.meta.url
);

const { drawnBackdrop, DRAWN_SCENES } = await import("../src/lib/backdrops.ts");
const { compositeProduct } = await import("../src/lib/composite.ts");

const out = path.resolve(process.argv[2] ?? "backdrop-preview");
fs.mkdirSync(out, { recursive: true });

// A stand-in product: a gold ring with a stone, with a transparent background.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="700"><defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e08a"/><stop offset=".5" stop-color="#c9951f"/><stop offset="1" stop-color="#8a5f0e"/></linearGradient>
  <radialGradient id="b" cx=".4" cy=".4"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9fd0ff"/></radialGradient></defs>
  <circle cx="350" cy="400" r="230" fill="none" stroke="url(#g)" stroke-width="64"/>
  <circle cx="350" cy="165" r="62" fill="url(#b)" stroke="url(#g)" stroke-width="14"/></svg>`;
const ring = await sharp(Buffer.from(svg)).png().toBuffer();

const tiles: Buffer[] = [];
for (const id of DRAWN_SCENES) {
  const t0 = Date.now();
  const bd = await drawnBackdrop(id);
  const img = await compositeProduct(ring, bd, { shadow: true });
  fs.writeFileSync(path.join(out, `${id}.jpg`), img);
  tiles.push(await sharp(img).resize(360, 450).jpeg({ quality: 85 }).toBuffer());
  console.log(id.padEnd(16), `${Date.now() - t0} ms`);
}
const cols = 3, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * 360, height: rows * 450, channels: 3, background: "#ffffff" } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 360, top: Math.floor(i / cols) * 450 })))
  .jpeg({ quality: 88 })
  .toFile(path.join(out, "contact-sheet.jpg"));
console.log("saved", path.join(out, "contact-sheet.jpg"));
