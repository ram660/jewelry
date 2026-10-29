import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// Let Node find "./x" as "./x.ts" (the app's bundler does this normally).
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

// A kit with an uploaded photo and a studio image. Claude itself is a stand-in: nothing is sent anywhere.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "efj-style-"));
process.env.EFJ_INSTA_DIR = root;
const kit = path.join(root, "hearts");
fs.mkdirSync(path.join(kit, ".source"), { recursive: true });
const jpg = await sharp({ create: { width: 60, height: 80, channels: 3, background: "#c9a14a" } }).jpeg().toBuffer();
fs.writeFileSync(path.join(kit, ".source", "photo-01.jpg"), jpg);
fs.writeFileSync(path.join(kit, "hearts_1_4x5_1080x1350.jpg"), jpg);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { askForStyle, readStyleState, buildStylePrompt } = await import("../src/lib/claudeStyle.ts");

const stand = (...answers: (string | Error)[]) => {
  const calls: { prompt: string; photos: number }[] = [];
  const ask = async (prompt: string, jpegs: Buffer[]) => {
    calls.push({ prompt, photos: jpegs.length });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  };
  return { ask, calls };
};
const ok = (style: Record<string, unknown> = {}) =>
  JSON.stringify({ verdict: "ok", flags: [], tone: "gold-tone", style: { backdrop: "charcoal", layout: "slightly-low", zoom: 0.85, closeup_focus: { x: 0.4, y: 0.7 }, shadow: "light", ...style } });

test("an ok answer becomes a layout from the fixed lists, with numbers kept in range", async () => {
  const c = stand(ok({ zoom: 1.7, closeup_focus: { x: -2, y: 9 } }));
  const r = await askForStyle("hearts", { ask: c.ask, configured: true });
  assert.equal(c.calls[0].photos, 2, "the owner's photo and the studio image");
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.deepEqual(r.style, { template: "noir", layout: "slightly-low", zoom: 1, shadow: "light", focus: { x: 0, y: 1 } });
  assert.equal(readStyleState("hearts")?.status, "ok", "the result is kept for the page");
});

test("asking again tells Claude what it chose last time, so the next version differs", async () => {
  const c = stand(ok({ backdrop: "cream" }));
  await askForStyle("hearts", { ask: c.ask, configured: true });
  assert.match(c.calls[0].prompt, /different from the last version \(noir, slightly-low\)/);
});

test("a flagged photo gets no Claude version, with a generic reason and never Claude's own words", async () => {
  const c = stand(JSON.stringify({ verdict: "flag", flags: ["cutout", "missing-parts", "made-up-code"], style: null, why: "BRANDNAME visible" }));
  const r = await askForStyle("hearts", { ask: c.ask, configured: true });
  assert.equal(r.status, "skipped");
  if (r.status !== "skipped") return;
  assert.equal(r.reason, "the cutout isn't clean; part of the piece is missing");
  assert.equal(r.mark, false);
  assert.ok(!JSON.stringify(readStyleState("hearts")).includes("BRANDNAME"));
});

test("a stamped mark skips the piece and is only ever called 'skipped'", async () => {
  const r = await askForStyle("hearts", { ask: stand(JSON.stringify({ verdict: "flag", flags: ["mark"], style: null })).ask, configured: true });
  assert.deepEqual([r.status, r.status === "skipped" && r.reason, r.status === "skipped" && r.mark], ["skipped", "skipped", true]);
});

test("a malformed answer, no key, or a failed call means 'unavailable' and the BiRefNet version carries on", async () => {
  const bad = await askForStyle("hearts", { ask: stand("Sure! I love the BRANDNAME piece {not json").ask, configured: true });
  assert.equal(bad.status, "unavailable");
  assert.ok(bad.status === "unavailable" && !bad.reason.includes("BRANDNAME"), "Claude's text is never echoed");

  const offer = await askForStyle("hearts", { ask: stand(ok({ backdrop: "neon" })).ask, configured: true });
  assert.equal(offer.status === "ok" && offer.style.template, "ivory", "an unknown backdrop falls back to cream");

  const none = stand(ok());
  const r = await askForStyle("hearts", { ask: none.ask, configured: false });
  assert.equal(none.calls.length, 0, "no key: Claude is never called");
  assert.match(r.status === "unavailable" ? r.reason : "", /no Claude API key/);

  const failed = await askForStyle("hearts", { ask: stand(new Error("401 invalid x-api-key sk-ant-api03-SECRETSECRET")).ask, configured: true });
  assert.equal(failed.status, "unavailable");
  assert.ok(!JSON.stringify(failed).includes("SECRETSECRET") && !JSON.stringify(readStyleState("hearts")).includes("SECRETSECRET"), "the key never reaches the page or the file");
});

test("the prompt says the jewellery is never changed and lists every reason to flag", () => {
  const p = buildStylePrompt(null);
  for (const s of ["You never change the jewellery", '"cutout"', '"distortion"', '"missing-parts"', '"mark"', '"backdrop-text"', '"low-quality"', "ONLY this JSON"]) assert.ok(p.includes(s), s);
});
