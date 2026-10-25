// Tests for the upload-to-render workflow: Gemini prompt, brand marks gate, plating rule, validation, duplicate detection.
// Run with: npm test   (Node's built-in test runner; uses a throw-away data folder, never your catalog)
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// Let Node find "./presets" as "./presets.ts" (the app's bundler does this normally).
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

// A throw-away catalog, set before anything that reads EFJ_DATA_DIR is loaded.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "efj-test-"));
process.env.EFJ_DATA_DIR = DATA;

const { buildGeminiPrompt, geminiStyles } = await import("../src/lib/geminiPrompt.ts");
const { checkProduct, scanText } = await import("../src/lib/claims.ts");
const { ProductPatch } = await import("../src/lib/productPatch.ts");
const db = await import("../src/lib/db.ts");
const storage = await import("../src/lib/storage.ts");
const { findDuplicateUploads, describeDuplicates } = await import("../src/lib/duplicates.ts");
import type { Product } from "../src/lib/types.ts";

test.after(() => {
  // Windows will not delete a database file that is still open.
  (globalThis as unknown as { __efjDb?: { close(): void } }).__efjDb?.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* a leftover temp folder is harmless */ }
});

// ---------------------------------------------------------------- Gemini prompt

const facts = { category: "bracelet" as const, gender: "women", colour_finish: "yellow gold, polished", stones: "clear cubic zirconia", marks_seen: [] as string[] };

test("the Gemini prompt tells it to keep every mark, engraving and stone exactly", () => {
  const p = buildGeminiPrompt(facts, "look:cream", { photos: 2 });
  assert.match(p, /attaching 2 photos of ONE real bracelet/);
  assert.match(p, /Keep every engraving, letter, number, logo, hallmark, monogram, stone/);
  assert.match(p, /Do not remove, blur, change, translate, redraw or add any of them/);
  assert.match(p, /If you cannot keep the piece exactly the same/);
  assert.match(p, /yellow gold, polished; stones: clear cubic zirconia/);
});

test("marks already recorded for the piece are named so they cannot be overlooked", () => {
  const p = buildGeminiPrompt({ ...facts, marks_seen: ["TIFFANY & Co.", "NEW YORK 925"] }, "look:dark", { photos: 1 });
  assert.match(p, /The marks on this piece are: "TIFFANY & Co\.", "NEW YORK 925"/);
  assert.match(p, /must stay exactly as written/);
  assert.match(p, /attaching 1 photo of ONE/);
});

test("every style builds a prompt, and worn styles depend on the kind of piece", () => {
  for (const category of ["ring", "bracelet", "chain", "necklace", "earring", "anklet", "set", "other"] as const) {
    const styles = geminiStyles(category);
    assert.ok(styles.some((s) => s.group === "Product shots") && styles.some((s) => s.group === "Worn"), category);
    for (const s of styles) assert.ok(buildGeminiPrompt({ ...facts, category }, s.id, { photos: 3 }).length > 300, `${category} ${s.id}`);
  }
  assert.ok(geminiStyles("ring").some((s) => s.label.includes("Hand")));
  assert.ok(geminiStyles("earring").some((s) => /ear/i.test(s.label)));
});

test("skin tone and extra wishes are included only when given, and are trimmed", () => {
  const worn = geminiStyles("ring")[geminiStyles("ring").findIndex((s) => s.group === "Worn")].id;
  assert.match(buildGeminiPrompt({ ...facts, category: "ring" }, worn, { photos: 1, skin: "deep" }), /deep brown skin/);
  assert.doesNotMatch(buildGeminiPrompt({ ...facts, category: "ring" }, worn, { photos: 1 }), /skin/);
  const p = buildGeminiPrompt(facts, "look:cream", { photos: 1, extra: `  a few dried flowers   ${"x".repeat(500)}` });
  assert.match(p, /ALSO: a few dried flowers x/);
  assert.ok(p.split("ALSO: ")[1].split("\n")[0].length <= 300);
  assert.doesNotMatch(buildGeminiPrompt(facts, "look:cream", { photos: 1 }), /ALSO:/);
});

test("an unknown style is an error and the prompt never contains a banned claim", () => {
  assert.throws(() => buildGeminiPrompt(facts, "nope", { photos: 1 }), /Unknown style/);
  for (const s of geminiStyles("bracelet")) assert.deepEqual(scanText(buildGeminiPrompt(facts, s.id, { photos: 1 })), [], s.id);
});

// ---------------------------------------------------------------- which cutout to use, and merging marks

const { pickCutout, alphaShare, STAND_RATIO } = await import("../src/lib/cutoutChoice.ts");
const { mergeMarks } = await import("../src/lib/ai.ts");

test("cutout choice follows the measurements on the owner's own photos", () => {
  // [BiRefNet share, colour-method share] from real photos: bangle 14.3/11.9 and 18.1/14.7, logo set on a bust 48.2/2.2, 9.8/2.7, 27.6/1.0
  assert.equal(pickCutout(14.3, 11.9), "birefnet");
  assert.equal(pickCutout(18.1, 14.7), "birefnet");
  assert.equal(pickCutout(48.2, 2.2), "gold");
  assert.equal(pickCutout(9.8, 2.7), "gold");
  assert.equal(pickCutout(27.6, 1.0), "gold");
  assert.ok(STAND_RATIO > 1.2 && STAND_RATIO < 3.7);
});

test("the share kept counts transparent pixels, not the colours of the photo", async () => {
  // A red photo with a 20x20 opaque square in a 100x100 picture keeps 4%. Red mean is 100%, so a colour-based reading would be far off.
  const red = { r: 255, g: 0, b: 0 };
  const square = await sharp({ create: { width: 100, height: 100, channels: 4, background: { ...red, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 20, height: 20, channels: 4, background: { ...red, alpha: 1 } } }).png().toBuffer(), left: 10, top: 10 }])
    .png().toBuffer();
  assert.ok(Math.abs((await alphaShare(square)) - 0.04) < 0.001);
  const bigger = await sharp({ create: { width: 100, height: 100, channels: 4, background: { ...red, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 60, height: 50, channels: 4, background: { ...red, alpha: 1 } } }).png().toBuffer(), left: 5, top: 5 }])
    .png().toBuffer();
  assert.equal(pickCutout(await alphaShare(bigger), await alphaShare(square)), "gold"); // 30% against 4% is a lot more than the metal
  assert.equal(await alphaShare(await sharp({ create: { width: 10, height: 10, channels: 3, background: red } }).png().toBuffer()), 1); // no alpha: everything kept
});

test("cutout choice copes with a missing or empty result", () => {
  assert.equal(pickCutout(10, 0), "birefnet");
  assert.equal(pickCutout(0, 10), "gold");
  assert.equal(pickCutout(Number.NaN, 5), "gold");
  assert.equal(pickCutout(5, Number.NaN), "birefnet");
});

test("marks are merged without losing the owner's wording or duplicating spacing variants", () => {
  assert.deepEqual(mergeMarks(["TIFFANY & Co."], ["TIFFANY&Co.", "925", " NEW YORK "]), ["TIFFANY & Co.", "925", "NEW YORK"]);
  assert.deepEqual(mergeMarks([], ["Cartier", "cartier", "CARTIER."]), ["Cartier"]);
  assert.deepEqual(mergeMarks(["Hand-made"], []), ["Hand-made"]);
  assert.deepEqual(mergeMarks([], ["", "  ", "…"]), []);
});

// ---------------------------------------------------------------- brand marks gate and plating

const base = (over: Partial<Product> = {}): Product => ({
  id: 1, sku: "EFJ-BR-0001", name: "Heart bangle", category: "bracelet", subcategory: "", gender: "women", plating: "10K gold-plated",
  base_metal: "", plating_microns: "", nickel_free: null, colour_finish: "yellow gold", stones: "", sizes: "", weight_g: null,
  price_cad: 40, cost_cad: null, compare_at_cad: null, stock_qty: 1, low_stock_at: 3, status: "draft", hypoallergenic: null,
  anti_tarnish: null, style_tags: [], occasion_tags: [], name_suggestions: [], short_desc: "", long_desc: "", care_notes: "",
  captions: [], hashtags: [], alt_text: "", owner_questions: [], marks_seen: [], authenticity: "", analysed_at: null,
  created_at: "", updated_at: "", ...over,
});
const blockers = (p: Product) => checkProduct(p, 1).filter((x) => x.level === "block").map((x) => x.message);
const warnings = (p: Product) => checkProduct(p, 1).filter((x) => x.level === "warn").map((x) => x.message);

test("a piece with no marks has no brand blocker", () => {
  assert.deepEqual(blockers(base()), []);
});

test("a mark with no answer blocks posting, and the message names the mark", () => {
  const b = blockers(base({ marks_seen: ["TIFFANY & Co."] }));
  assert.equal(b.length, 1);
  assert.match(b[0], /another brand's mark \(TIFFANY & Co\.\)/);
  assert.match(b[0], /genuine/);
});

test("not genuine blocks posting, genuine only warns, and the marks are never altered", () => {
  const marks = ["Cartier", "750"];
  assert.match(blockers(base({ marks_seen: marks, authenticity: "not_genuine" })).join(" "), /not genuine, so it cannot be posted/);
  const genuine = base({ marks_seen: marks, authenticity: "genuine" });
  assert.deepEqual(blockers(genuine), []);
  assert.ok(warnings(genuine).some((w) => /receipt or certificate/.test(w)));
  assert.deepEqual(genuine.marks_seen, ["Cartier", "750"]);
});

test("plating: gold-plated and rhodium-plated pass, an unplated description does not, silver with gold plating warns", () => {
  assert.deepEqual(blockers(base({ plating: "rhodium-plated", colour_finish: "silver" })), []);
  assert.ok(blockers(base({ plating: "" })).some((m) => /how it is plated/.test(m)));
  assert.ok(blockers(base({ plating: "solid brass" })).some((m) => /how it is plated/.test(m)));
  assert.ok(warnings(base({ plating: "10K gold-plated", colour_finish: "silver, polished" })).some((w) => /silver or white/.test(w)));
  assert.ok(!warnings(base()).some((w) => /silver or white/.test(w)));
  // A genuine branded piece is whatever it really is.
  assert.deepEqual(blockers(base({ plating: "925 sterling silver", marks_seen: ["Tiffany"], authenticity: "genuine" })), []);
});

test("product edits accept marks and the genuine answer, and refuse nonsense", () => {
  const ok = ProductPatch.safeParse({ marks_seen: ["TIFFANY & Co.", "925"], authenticity: "not_genuine" });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.marks_seen, ["TIFFANY & Co.", "925"]);
  assert.ok(ProductPatch.safeParse({ authenticity: "" }).success);
  assert.equal(ProductPatch.safeParse({ authenticity: "maybe" }).success, false);
  assert.equal(ProductPatch.safeParse({ marks_seen: "not a list" }).success, false);
});

// ---------------------------------------------------------------- duplicate detection

const jpegBytes = (seed: number) =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (seed * 53) % 255, g: (seed * 97) % 255, b: (seed * 17) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><circle cx="${100 + seed * 30}" cy="240" r="${60 + seed * 5}" fill="#c9951f"/></svg>`) }])
    .jpeg().toBuffer();
const asFile = (buf: Buffer, name: string) => new File([new Uint8Array(buf)], name, { type: "image/jpeg" });

test("the same photo is recognised as already in the catalog, a different one is not", async () => {
  const a = await jpegBytes(1), b = await jpegBytes(2);
  const p = db.createProduct("Logo set", "set");
  await storage.ingestFiles(p.id, [asFile(a, "IMG_1.jpg")]);

  const same = await findDuplicateUploads([asFile(a, "copy-of-IMG_1.jpg")]);
  assert.equal(same.existing.length, 1);
  assert.equal(same.existing[0].product_id, p.id);
  assert.equal(same.existing[0].file, "copy-of-IMG_1.jpg");
  assert.match(describeDuplicates(same), /already in Logo set/);

  const other = await findDuplicateUploads([asFile(b, "IMG_2.jpg")]);
  assert.deepEqual(other, { existing: [], repeated: [] });
});

test("the same photo twice in one upload is reported", async () => {
  const c = await jpegBytes(3);
  const r = await findDuplicateUploads([asFile(c, "a.jpg"), asFile(c, "b.jpg"), asFile(await jpegBytes(4), "d.jpg")]);
  assert.deepEqual(r.repeated, ["b.jpg"]);
  assert.match(describeDuplicates(r), /more than once/);
});

test("photos saved before fingerprints existed are found too, once their fingerprint is filled in", async () => {
  const d = await jpegBytes(5);
  const p = db.createProduct("Older product", "ring");
  const saved = await storage.saveImage(d, p.id);
  db.addImage(p.id, saved.file, saved.thumb, 0, {}); // no sha256, like a row from the old app
  assert.equal(db.originalsMissingHash().length >= 1, true);
  const r = await findDuplicateUploads([asFile(d, "again.jpg")]);
  assert.equal(r.existing.length, 1);
  assert.equal(r.existing[0].product_id, p.id);
  assert.equal(db.originalsMissingHash().length, 0);
});

test("products that share photos are grouped, and unrelated ones are left out", async () => {
  const e = await jpegBytes(6), f = await jpegBytes(7), g = await jpegBytes(8);
  const x = db.createProduct("X", "set"), y = db.createProduct("Y", "set"), z = db.createProduct("Z", "set");
  await storage.ingestFiles(x.id, [asFile(e, "1.jpg"), asFile(f, "2.jpg")]);
  await storage.ingestFiles(y.id, [asFile(e, "1.jpg")]);
  await storage.ingestFiles(z.id, [asFile(f, "2.jpg"), asFile(g, "3.jpg")]);
  const group = db.duplicateProductGroups().find((gr) => gr.product_ids.includes(x.id));
  assert.ok(group);
  assert.deepEqual(group.product_ids, [x.id, y.id, z.id].sort((m, n) => m - n)); // y and z are linked through x
  const lone = db.createProduct("Lone", "ring");
  await storage.ingestFiles(lone.id, [asFile(await jpegBytes(9), "solo.jpg")]);
  assert.ok(!db.duplicateProductGroups().some((gr) => gr.product_ids.includes(lone.id)));
});

test("rendered pictures never count as duplicates of the owner's photos", async () => {
  const h = await jpegBytes(10);
  const p = db.createProduct("Has renders", "ring");
  const [id] = await storage.ingestFiles(p.id, [asFile(h, "o.jpg")]);
  const saved = await storage.saveImage(h, p.id);
  db.addImage(p.id, saved.file, saved.thumb, 5, { kind: "studio", source_image_id: id });
  const r = await findDuplicateUploads([asFile(h, "o2.jpg")]);
  assert.equal(r.existing.length, 1);
  assert.equal(db.findOriginalsByHash([saved.sha256]).length, 1); // only the original, not the studio copy
});
