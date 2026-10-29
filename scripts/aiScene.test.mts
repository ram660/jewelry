import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

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

// A kit folder with a cached cut-out and studio images. Gemini and the match check are stand-ins: nothing leaves this computer.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "efj-aiscene-"));
process.env.EFJ_INSTA_DIR = root;
delete process.env.FIDELITY_MIN;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jpg = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#d4af37" } }).jpeg().toBuffer();
const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 212, g: 175, b: 55, alpha: 1 } } }).png().toBuffer();
function makeKit(slug: string) {
  const dir = path.join(root, slug);
  fs.mkdirSync(path.join(dir, ".cutouts"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".cutouts", "abc.json"), JSON.stringify({ png: png.toString("base64"), coverage: 0.2 }));
  for (const f of [`${slug}_1_4x5_1080x1350.jpg`, `${slug}_1_closeup_4x5_1080x1350.jpg`, `${slug}_1_story_9x16_1080x1920.jpg`]) fs.writeFileSync(path.join(dir, f), jpg);
  return dir;
}

const { generateAiScenes, readAiScenes, aiScenePrompt, AI_STYLE_IDS } = await import("../src/lib/aiScene.ts");
const { readKit, saveDraft } = await import("../src/lib/kits.ts");

const ok = (score: number, marks = false) => async () => ({ score, notes: "Looks the same.", marks });
const gen = async () => jpg;
const quiet = () => {};

test("every style's prompt keeps the piece unchanged and forbids text and logos", () => {
  for (const s of AI_STYLE_IDS) {
    const p = aiScenePrompt(s);
    assert.match(p, /EXACT piece/);
    assert.match(p, /Do not add, remove/);
    assert.match(p, /No text, letters, numbers, logos, brand marks/);
  }
});

test("a good scene is kept with its match score, and the draft's selection is left alone", async () => {
  makeKit("good");
  const before = readKit("good")!.draft;
  saveDraft("good", before);
  let refs = 0;
  const r = await generateAiScenes("good", { count: 2, style: "marble" }, quiet, {
    configured: true,
    model: "test-model",
    generate: async (_p, jpegs) => ((refs = jpegs.length), jpg),
    check: ok(91),
  });
  assert.equal(refs, 1, "the cached cut-out is the reference");
  assert.equal(r.kept.length, 2);
  assert.deepEqual(r.kept.map((k) => k.file), ["good_1_ai_4x5_1080x1350.jpg", "good_2_ai_4x5_1080x1350.jpg"]);
  for (const k of r.kept) {
    assert.equal(k.score, 91);
    assert.equal(k.low, false);
    const m = await sharp(path.join(root, "good", k.file)).metadata();
    assert.deepEqual([m.width, m.height], [1080, 1350]);
  }
  assert.equal(readAiScenes("good").length, 2);
  const after = readKit("good")!;
  assert.deepEqual(after.draft.slides, before.slides);
  assert.equal(after.draft.look, "studio");
  assert.equal(after.files.ai.length, 2);
});

test("a low match is kept but flagged", async () => {
  makeKit("low");
  const r = await generateAiScenes("low", { count: 1, style: "silk" }, quiet, { configured: true, generate: gen, check: ok(60) });
  assert.equal(r.kept[0].low, true);
  assert.equal(readAiScenes("low")[0].score, 60);
});

test("a scene with text or a logo is thrown away", async () => {
  makeKit("marks");
  await assert.rejects(generateAiScenes("marks", { count: 1, style: "daylight" }, quiet, { configured: true, generate: gen, check: ok(95, true) }), /text or a logo/);
  assert.equal(readKit("marks")!.files.ai.length, 0);
  // With two, the clean one is kept and the other is reported.
  let n = 0;
  const r = await generateAiScenes("marks", { count: 2, style: "daylight" }, quiet, { configured: true, generate: gen, check: async () => ({ score: 90, notes: "", marks: n++ === 0 }) });
  assert.equal(r.kept.length, 1);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0], /text or a logo/);
});

test("a scene the match check couldn't score is thrown away", async () => {
  makeKit("nocheck");
  await assert.rejects(
    generateAiScenes("nocheck", { count: 1, style: "marble" }, quiet, { configured: true, generate: gen, check: async () => ({ score: null, notes: "The automatic check could not run.", marks: false }) }),
    /match check couldn't run/
  );
  assert.equal(readKit("nocheck")!.files.ai.length, 0);
});

test("a Gemini failure is reported and nothing is saved", async () => {
  makeKit("fail");
  await assert.rejects(
    generateAiScenes("fail", { count: 1, style: "marble" }, quiet, { configured: true, generate: async () => { throw new Error("Gemini rate limit or quota reached."); }, check: ok(99) }),
    /Gemini couldn't make it \(Gemini rate limit/
  );
  assert.equal(readKit("fail")!.files.ai.length, 0);
});

test("a reply that isn't a picture drops that scene only", async () => {
  makeKit("garbled");
  let n = 0;
  const r = await generateAiScenes("garbled", { count: 2, style: "silk" }, quiet, {
    configured: true,
    generate: async () => (n++ === 0 ? Buffer.from("not an image") : jpg),
    check: ok(88),
  });
  assert.equal(r.kept.length, 1);
  assert.match(r.dropped[0], /couldn't be read or checked/);
});

test("without a Gemini key nothing is attempted", async () => {
  makeKit("nokey");
  let called = false;
  await assert.rejects(
    generateAiScenes("nokey", { count: 1, style: "marble" }, quiet, { configured: false, generate: async () => ((called = true), jpg), check: ok(99) }),
    /No Gemini API key/
  );
  assert.equal(called, false);
});

test("AI scenes are only started by the button: never on upload, page load or kit making", () => {
  const src = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
  const page = src("src/app/instagram/[slug]/page.tsx");
  // The endpoint is called in exactly one place, the button's handler, and that handler is only wired to onClick.
  assert.equal(page.match(/\/ai-scene`/g)?.length, 1);
  const handler = page.slice(page.indexOf("async function generateAi()"));
  assert.ok(handler.slice(0, handler.indexOf("\n  }\n")).includes("/ai-scene`"));
  assert.deepEqual(page.match(/generateAi\b(?!\(\) \{)/g)?.length, 1);
  assert.match(page, /onClick=\{generateAi\}/);
  for (const effect of page.split("useEffect(").slice(1)) assert.ok(!/generateAi|ai-scene/.test(effect.slice(0, effect.indexOf("}, ["))));
  // Making a kit, loading a kit and uploading never touch it.
  const jobs = src("src/lib/kitJobs.ts");
  const startKit = jobs.slice(jobs.indexOf("export function startKit"), jobs.indexOf("export const BACKDROPS"));
  assert.ok(!/generateAiScenes|startAiScene/.test(startKit));
  assert.ok(!/startAiScene|generateAiScenes/.test(src("src/app/api/instagram/kits/route.ts")));
  assert.ok(!/startAiScene|generateAiScenes/.test(src("src/app/api/instagram/kits/[slug]/route.ts")));
});
