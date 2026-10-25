import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";

// Let Node find "./composite" as "./composite.ts" (the app's bundler does this normally).
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
const { SCENES, SCENE_BACKDROP } = await import("../src/lib/presets.ts");
const { CANVAS } = await import("../src/lib/composite.ts");

test("every styled scene has a drawn backdrop", () => {
  for (const s of SCENES) {
    assert.ok(DRAWN_SCENES.includes(s.id), `no drawn backdrop for scene ${s.id}`);
    assert.ok(SCENE_BACKDROP[s.id], `no description for scene ${s.id}`);
  }
});

test("each backdrop is a 4:5 JPEG with real texture, and all are different", async () => {
  const hashes = new Set<string>();
  for (const id of DRAWN_SCENES) {
    const buf = await drawnBackdrop(id);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.width, CANVAS.width, id);
    assert.equal(meta.height, CANVAS.height, id);
    assert.equal(meta.format, "jpeg", id);
    const stats = await sharp(buf).stats();
    const spread = Math.max(...stats.channels.map((c) => c.stdev));
    assert.ok(spread > 4, `${id} looks flat (spread ${spread.toFixed(1)})`);
    hashes.add(crypto.createHash("sha256").update(buf).digest("hex"));
  }
  assert.equal(hashes.size, DRAWN_SCENES.length);
});

test("drawing is deterministic: the same scene is the same picture every time", async () => {
  for (const id of ["marble", "sea-glass", "festive-diwali"]) {
    const a = await drawnBackdrop(id);
    const b = await drawnBackdrop(id);
    assert.ok(a.equals(b), id);
  }
});

test("an unknown scene is an error, not a blank picture", async () => {
  await assert.rejects(drawnBackdrop("nope"), /no drawn backdrop/);
});
