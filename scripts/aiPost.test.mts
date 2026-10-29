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

// A kit folder with real (tiny) images, so the writer can load its photos. The AI itself is a stand-in.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "efj-aipost-"));
process.env.EFJ_INSTA_DIR = root;
const kit = path.join(root, "clover");
fs.mkdirSync(kit);
const jpg = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#d4af37" } }).jpeg().toBuffer();
for (const f of ["clover_1_4x5_1080x1350.jpg", "clover_1_closeup_4x5_1080x1350.jpg", "clover_1_story_9x16_1080x1920.jpg"]) fs.writeFileSync(path.join(kit, f), jpg);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { writePost, buildPostPrompt, CTA } = await import("../src/lib/aiPost.ts");
const { Draft, draftProblems, finalCaption } = await import("../src/lib/kitDraft.ts");
const { kitFiles } = await import("../src/lib/kits.ts");

const files = kitFiles("clover");
const base = () => Draft.parse({ slides: [files.main[0], files.closeup[0]], fields: { price: "", order: "", length: "" } });
const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: "set",
    tone: "gold",
    caption: `Red and gold, ready for the festive season ✨\n\nFive clover charms on a fine 10K gold-plated chain, with matching studs.\n\n$[PRICE] CAD. ${CTA}`,
    hashtags: ["#ElegantFashionJewellery", "#fourleafclover", "clovernecklace", "#festivejewellery"],
    alt_main: "A gold-tone clover necklace and studs on a charcoal background.",
    alt_closeup: "Close-up of the clover charms.",
    marks_seen: [],
    ...over,
  });
function fakeAi(...answers: string[]) {
  const calls: { prompt: string; photos: number }[] = [];
  const ask = async (prompt: string, jpegs: Buffer[]) => {
    calls.push({ prompt, photos: jpegs.length });
    return answers[Math.min(calls.length - 1, answers.length - 1)];
  };
  return { ask, calls };
}

test("the AI's caption, hashtags and alt text land in the draft, with the price left as a blank", async () => {
  const ai = fakeAi(reply());
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: "gemini" });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].photos, 2, "the main photo and the close-up are sent");
  assert.match(d.caption, /\$\[PRICE\] CAD\. Comment ✨/);
  assert.ok(d.hashtags.startsWith("#ElegantFashionJewellery #vancouverjewellery #shopsmallyvr #yvrstyle"));
  assert.match(d.hashtags, /#clovernecklace/, "a tag without # gets one");
  assert.equal(d.alts[files.main[0]], "A gold-tone clover necklace and studs on a charcoal background.");
  assert.equal(d.category, "set");
  assert.match(d.aiNote, /Written by AI \(gemini\)/);
  assert.deepEqual(draftProblems(d, files), ["Fill in or remove: [PRICE]"], "Post waits for the owner's price");
  d.fields.price = "35";
  assert.deepEqual(draftProblems(d, files), []);
  assert.match(finalCaption(d), /\$35 CAD\. Comment ✨/);
});

test("a price the AI made up is turned back into the blank", async () => {
  const ai = fakeAi(reply({ caption: "Gift sorted 🎁\n\nThe clover set.\n\n$49.99 CAD. Comment ✨ and we'll DM you the details." }));
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: "gemini" });
  assert.ok(!/49/.test(d.caption));
  assert.match(d.caption, /\$\[PRICE\] CAD\./);
});

test("gold-plated on a silver-tone piece, a length, or banned wording is rejected and asked again", async () => {
  const ai = fakeAi(reply({ tone: "silver" }), reply({ tone: "silver", caption: `Cool and bright 🤍\n\nA silver-tone clover set.\n\n$[PRICE] CAD. ${CTA}`, alt_main: "A silver-tone set." }));
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: "gemini" });
  assert.equal(ai.calls.length, 2);
  assert.equal(d.tone, "silver");
  assert.ok(!/gold-plated/i.test(d.caption));

  const len = fakeAi(reply({ caption: `On an 18 inch chain ✨\n\n$[PRICE] CAD. ${CTA}` }), reply());
  await writePost("clover", base(), { name: "Clover set" }, { ask: len.ask, provider: "gemini" });
  assert.equal(len.calls.length, 2, "a length the owner never gave is not accepted");
});

test("two bad answers fall back to the simple templates, and the page is told why", async () => {
  const ai = fakeAi(reply({ caption: "Solid gold and waterproof ✨" }));
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: "gemini" });
  assert.equal(ai.calls.length, 2);
  assert.match(d.aiNote, /couldn't write this one/);
  assert.ok(!/Solid gold|waterproof/i.test(d.caption));
  assert.match(d.caption, /10K gold-plated/);

  const broken = await writePost("clover", base(), { name: "Clover set" }, { ask: async () => "not json at all", provider: "gemini" });
  assert.match(broken.aiNote, /simple template/);
});

test("no AI set up: templates, and the AI is never called", async () => {
  const ai = fakeAi(reply());
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: null });
  assert.equal(ai.calls.length, 0);
  assert.match(d.aiNote, /AI isn't set up/);
  assert.ok(d.caption.length > 0);
});

test("a mark seen on the piece skips it: Post is off and the mark is never written down", async () => {
  const ai = fakeAi(reply({ marks_seen: ["ACME LOGO"] }));
  const d = await writePost("clover", base(), { name: "Clover set" }, { ask: ai.ask, provider: "gemini" });
  assert.equal(d.marked, true);
  assert.deepEqual(draftProblems(d, files), ["Skipped: this piece can't be posted from here."]);
  assert.ok(!JSON.stringify(d).includes("ACME"), "the mark's text is not kept anywhere");
});

test("a rewrite keeps the owner's price, slides and choices, and the owner's corrections go to the AI", async () => {
  const b = Draft.parse({ ...base(), fields: { price: "35", order: "", length: "" }, story: false, slides: [files.main[0]] });
  const ai = fakeAi(reply());
  const d = await writePost("clover", b, { name: "Clover set", category: "necklace", tone: "gold" }, { ask: ai.ask, provider: "gemini" });
  assert.equal(d.fields.price, "35");
  assert.equal(d.story, false);
  assert.deepEqual(d.slides, [files.main[0]]);
  assert.equal(d.category, "necklace", "the owner's correction wins over the AI's guess");
  assert.match(ai.calls[0].prompt, /Type \(owner set\): necklace/);
});

test("the prompt carries the rules and no owner facts it could leak", () => {
  const p = buildPostPrompt({ name: "Clover set" }, "BRAND");
  for (const rule of ["10K gold-plated", "silver-tone", "$[PRICE] CAD", "dupe", "marks_seen", "Canadian spelling"]) assert.ok(p.includes(rule), rule);
});

test("US spellings from the AI are made Canadian", async () => {
  const { canadian } = await import("../src/lib/aiPost.ts");
  assert.equal(canadian("Centered on a gray background, in my favorite color. Jewelry!"), "Centred on a grey background, in my favourite colour. Jewellery!");
});

test("original photos are framed 4:5 and 9:16 without touching the upload; studio images can go back to the previous version", async () => {
  const { makeOriginals, snapshotStudio, swapPrevious, hasPrevious, hasSource, kitFiles: files2 } = await import("../src/lib/kits.ts");
  const src = path.join(kit, ".source");
  fs.mkdirSync(src, { recursive: true });
  const upload = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#b08d57" } }).jpeg().toBuffer();
  fs.writeFileSync(path.join(src, "photo-01.jpg"), upload);
  assert.equal(hasSource("clover"), true);
  await makeOriginals("clover");
  const f = files2("clover");
  assert.deepEqual(f.original, ["clover_1_original_4x5_1080x1350.jpg"]);
  const m4 = await sharp(path.join(kit, f.original[0])).metadata();
  const m9 = await sharp(path.join(kit, f.originalStory[0])).metadata();
  assert.deepEqual([m4.width, m4.height, m9.width, m9.height], [1080, 1350, 1080, 1920]);
  assert.ok(fs.readFileSync(path.join(src, "photo-01.jpg")).equals(upload), "the upload itself is unchanged");

  const main = path.join(kit, "clover_1_4x5_1080x1350.jpg");
  const before = fs.readFileSync(main);
  snapshotStudio("clover");
  fs.writeFileSync(main, Buffer.from("new version"));
  assert.equal(hasPrevious("clover"), true);
  assert.equal(swapPrevious("clover"), true);
  assert.ok(fs.readFileSync(main).equals(before), "back to the previous version");
  assert.equal(swapPrevious("clover"), true);
  assert.equal(String(fs.readFileSync(main)), "new version", "and forward again");
});
