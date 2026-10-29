import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

// Let Node find "./posters" as "./posters.ts" (the app's bundler does this normally).
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (/^[.][.]?[/]/.test(s) && !/[.]\w+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
}`),
  import.meta.url
);

const { jewelleryLook } = await import("../src/lib/look.ts");
const { maskedMedianLab, deltaE2000 } = await import("../src/lib/colourMatch.ts");

const swatches: [string, number[]][] = [["red pearl", [190, 35, 40]], ["coral", [230, 110, 80]], ["emerald", [30, 140, 80]], ["sapphire", [40, 60, 170]], ["gold", [205, 165, 70]]];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${140 * swatches.length}" height="140"><defs>${swatches
  .map(([, c], i) => `<radialGradient id="g${i}" cx="40%" cy="35%"><stop offset="0" stop-color="rgb(${c.map((v) => Math.min(255, v + 40))})"/><stop offset="0.6" stop-color="rgb(${c})"/><stop offset="1" stop-color="rgb(${c.map((v) => Math.round(v * 0.6))})"/></radialGradient>`)
  .join("")}</defs>${swatches.map((_, i) => `<circle cx="${70 + i * 140}" cy="70" r="60" fill="url(#g${i})"/>`).join("")}</svg>`;

const cut = await sharp(Buffer.from(svg)).png().toBuffer();
const out = await jewelleryLook(cut, [1, 1, 1]);
const region = async (png: Buffer, i: number) =>
  maskedMedianLab(await sharp(png).extract({ left: 30 + i * 140, top: 30, width: 80, height: 80 }).ensureAlpha().raw().toBuffer())!;
const hue = (c: { a: number; b: number }) => (Math.atan2(c.b, c.a) * 180) / Math.PI;
const chroma = (c: { a: number; b: number }) => Math.hypot(c.a, c.b);

test("studio retouch keeps the colour of coloured stones", async () => {
  for (let i = 0; i < 4; i++) {
    const was = (await region(cut, i))!, now = (await region(out, i))!;
    assert.ok(Math.abs(hue(now) - hue(was)) < 1.5, `${swatches[i][0]} hue ${hue(was)} -> ${hue(now)}`);
    assert.ok(Math.abs(chroma(now) - chroma(was)) < 2.5, `${swatches[i][0]} chroma ${chroma(was)} -> ${chroma(now)}`);
  }
});

test("studio retouch still adds vibrance to gold", async () => {
  const was = (await region(cut, 4))!, now = (await region(out, 4))!;
  assert.ok(chroma(now) > chroma(was) + 5 && deltaE2000(was, now) > 2);
});
