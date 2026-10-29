import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Let Node find "./claims" as "./claims.ts" (the app's bundler does this normally).
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "efj-reels-"));
process.env.EFJ_INSTA_DIR = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { RECIPES, nextRecipe, nextTrack, priceCard } = await import("../src/lib/reelRecipes.ts");
const { addReel, chooseReel, nextReelFile, readReels, KEEP_REELS } = await import("../src/lib/reelVariants.ts");

const fields = (price: string, order = "Comment ✨ and we'll DM you the details.") => ({ price, order, length: "" });

test("the style never repeats twice in a row, and every style comes up", () => {
  let last: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const r = nextRecipe(last);
    assert.notEqual(r, last);
    seen.add(r);
    last = r;
  }
  assert.equal(seen.size, RECIPES.length);
  // Even a generator stuck at its edges can't repeat.
  assert.notEqual(nextRecipe("zoom", () => 0), "zoom");
  assert.notEqual(nextRecipe("kenburns", () => 0.9999), "kenburns");
});

test("one track is used every time", () => {
  for (let i = 0; i < 20; i++) assert.deepEqual(nextTrack(["Soft glow.mp3"], "Soft glow.mp3", false), { track: "Soft glow.mp3" });
});

test("with several tracks, the next one is a different track", () => {
  const tracks = ["A.mp3", "B.mp3", "C.mp3"];
  let last: string | null = null;
  for (let i = 0; i < 200; i++) {
    const r = nextTrack(tracks, last, false);
    assert.ok("track" in r && r.track);
    assert.notEqual(r.track, last);
    last = r.track;
  }
});

test("no tracks gives a clear message, unless the Reel is muted", () => {
  const r = nextTrack([], null, false);
  assert.ok("error" in r && /no music in the audio folder/i.test(r.error) && /Mute/.test(r.error));
  assert.deepEqual(nextTrack([], null, true), { track: null });
  assert.deepEqual(nextTrack(["A.mp3"], null, true), { track: null });
});

test("the price card needs a price and clean text", () => {
  assert.equal(priceCard(fields("")), null);
  assert.equal(priceCard(fields("  ")), null);
  assert.equal(priceCard(fields("abc")), null);
  assert.deepEqual(priceCard(fields("40")), { price: "$40 CAD", order: "Comment and we'll DM you the details." });
  assert.deepEqual(priceCard(fields("$39.5 CAD", "")), { price: "$39.50 CAD", order: "" });
  // A blank or a banned claim on the card means no card.
  assert.equal(priceCard(fields("40", "[ORDER CTA]")), null);
  assert.equal(priceCard(fields("40", "Waterproof and tarnish-free!")), null);
});

test("the last three Reels are kept, the newest is chosen, and any kept one can be chosen", () => {
  const slug = "test-piece";
  fs.mkdirSync(path.join(root, slug));
  const made: string[] = [];
  for (let i = 0; i < KEEP_REELS + 2; i++) {
    const file = nextReelFile(slug);
    fs.writeFileSync(path.join(root, slug, file), `video ${i}`);
    addReel(slug, { file, recipe: RECIPES[i % RECIPES.length].id, track: i % 2 ? null : "A.mp3", at: new Date().toISOString() });
    made.push(file);
  }
  const s = readReels(slug);
  assert.deepEqual(s.items.map((i) => i.file), made.slice(-KEEP_REELS));
  assert.equal(s.chosen, made[made.length - 1]);
  for (const old of made.slice(0, -KEEP_REELS)) assert.equal(fs.existsSync(path.join(root, slug, old)), false);
  const reel = path.join(root, slug, `${slug}_reel_9x16.mp4`);
  assert.equal(fs.readFileSync(reel, "utf8"), `video ${made.length - 1}`);

  assert.equal(chooseReel(slug, made[made.length - 2]), true);
  assert.equal(readReels(slug).chosen, made[made.length - 2]);
  assert.equal(fs.readFileSync(reel, "utf8"), `video ${made.length - 2}`);
  assert.equal(chooseReel(slug, made[0]), false, "a deleted Reel can't be chosen");
  assert.equal(chooseReel(slug, "../../etc/passwd"), false);
});
