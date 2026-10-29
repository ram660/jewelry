import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

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

const { Draft, applyFields, draftProblems, finalCaption, planPosts, sortKitFiles, postGroup, draftFromNotes } = await import("../src/lib/kitDraft.ts");
const { templateDraft } = await import("../src/lib/kits.ts");

const files = sortKitFiles([
  "k_2_4x5_1080x1350.jpg", "k_1_4x5_1080x1350.jpg", "k_1_closeup_4x5_1080x1350.jpg", "k_1_1x1_1080x1080.jpg",
  "k_1_story_9x16_1080x1920.jpg", "k_reel_9x16.mp4", "k_post-notes.md",
]);
const good = () =>
  Draft.parse({
    caption: "Red and gold ✨\n\n$[PRICE] CAD. [ORDER CTA]",
    hashtags: "#ElegantFashionJewellery #vancouverjewellery",
    slides: ["k_1_4x5_1080x1350.jpg", "k_1_closeup_4x5_1080x1350.jpg"],
    alts: { "k_1_4x5_1080x1350.jpg": "A gold-tone necklace on charcoal." },
    fields: { price: "35", order: "Comment ✨ and we'll DM you the details.", length: "" },
  });

test("sorts a kit's files by use", () => {
  assert.deepEqual(files.main, ["k_1_4x5_1080x1350.jpg", "k_2_4x5_1080x1350.jpg"]);
  assert.deepEqual(files.closeup, ["k_1_closeup_4x5_1080x1350.jpg"]);
  assert.equal(files.reel, "k_reel_9x16.mp4");
  assert.deepEqual(files.story, ["k_1_story_9x16_1080x1920.jpg"]);
});

test("the price and order fields fill the blanks, and a filled draft can be posted", () => {
  const d = good();
  assert.equal(finalCaption(d), "Red and gold ✨\n\n$35 CAD. Comment ✨ and we'll DM you the details.\n\n#ElegantFashionJewellery #vancouverjewellery");
  assert.deepEqual(draftProblems(d, files), []);
  assert.equal(applyFields("$[PRICE] CAD", { price: "$35 CAD", order: "", length: "" }), "$35 CAD");
  assert.deepEqual(planPosts(d, files).map((p) => p.kind), ["carousel", "story"]);
});

test("Post is disabled while a blank is left or banned wording is in the text", () => {
  const d = good();
  d.fields.price = "";
  assert.match(draftProblems(d, files).join("\n"), /\[PRICE\]/);
  const e = good();
  e.alts["k_1_closeup_4x5_1080x1350.jpg"] = "A [COLOUR] clover.";
  assert.match(draftProblems(e, files).join("\n"), /\[COLOUR\]/);
  const f = good();
  f.caption = "Solid gold clovers, waterproof too ✨";
  assert.ok(draftProblems(f, files).length > 0);
  const g = good();
  g.caption = "";
  assert.match(draftProblems(g, files).join("\n"), /caption/i);
});

test("nothing selected, an unknown slide, a missing Reel or something already posted stops Post", () => {
  const d = good();
  d.feed = false;
  d.story = false;
  assert.match(draftProblems(d, files).join("\n"), /Nothing is selected/);
  const e = good();
  e.slides = ["../../.env.local"];
  assert.match(draftProblems(e, files).join("\n"), /not one of this kit's photos/);
  const f = good();
  f.reel = true;
  assert.match(draftProblems(f, { ...files, reel: null }).join("\n"), /Build the Reel/);
  assert.deepEqual(planPosts(f, files).map((p) => p.kind), ["carousel", "reel", "story"]);
  assert.match(draftProblems(good(), files, ["story"]).join("\n"), /Story is already on Instagram/);
  assert.deepEqual(draftProblems({ ...good(), story: false }, files, ["story"]), []);
});

test("photo posts, Stories and Reels are logged as separate groups", () => {
  assert.deepEqual(["image", "carousel", "story", "reel"].map(postGroup), ["feed", "feed", "story", "reel"]);
});

test("a Story-only post needs no caption", () => {
  const d = Draft.parse({ feed: false, story: true });
  assert.deepEqual(draftProblems(d, files), []);
});

test("first draft from post notes: caption 1, hashtags, main photo then close-up with their alt text", () => {
  const d = draftFromNotes({ captions: ["One", "Two"], hashtags: "#a #b", alt: { slide1: "Main.", slide2: "Close." } }, files);
  assert.equal(d.caption, "One");
  assert.deepEqual(d.slides, ["k_1_4x5_1080x1350.jpg", "k_1_closeup_4x5_1080x1350.jpg"]);
  assert.equal(d.alts["k_1_closeup_4x5_1080x1350.jpg"], "Close.");
});

test("template captions for a new kit: 10K gold-plated only when the owner picked gold, a price blank when no price", () => {
  const gold = templateDraft({ name: "Clover set", category: "set", finish: "gold", price: "" }, files);
  assert.match(gold.caption, /10K gold-plated/);
  assert.match(gold.caption, /\$\[PRICE\] CAD\. /);
  assert.match(draftProblems(gold, files).join("\n"), /\[PRICE\]/);
  assert.deepEqual(draftProblems({ ...gold, fields: { ...gold.fields, price: "35" } }, files), []);
  const silver = templateDraft({ name: "Moon hoops", category: "earring", finish: "silver", price: "25" }, files);
  assert.ok(!/gold-plated/i.test(silver.caption));
  assert.match(silver.caption, /\$25 CAD/);
  assert.match(draftProblems(silver, files).join("\n"), /CONFIRM FINISH/);
});

test("photo uploads can be bigger than Next's 10 MB default (the middleware would cut them off: 'Failed to fetch')", async () => {
  const fs = await import("node:fs");
  const cfg = fs.readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  const m = cfg.match(/middlewareClientMaxBodySize:\s*"(\d+)mb"/);
  assert.ok(m, "next.config.ts sets experimental.middlewareClientMaxBodySize");
  assert.ok(Number(m![1]) >= 50, "at least 50 MB, enough for a batch of shrunk phone photos");
});

test("my original photos: Post, the Story and the slides use whichever look is chosen", async () => {
  const { slidesFor, storyFile } = await import("../src/lib/kitDraft.ts");
  const f = sortKitFiles([...[...files.main, ...files.closeup, ...files.story], "k_1_original_4x5_1080x1350.jpg", "k_2_original_4x5_1080x1350.jpg", "k_1_original_story_9x16_1080x1920.jpg"]);
  assert.deepEqual(f.original, ["k_1_original_4x5_1080x1350.jpg", "k_2_original_4x5_1080x1350.jpg"]);
  assert.deepEqual(f.main, ["k_1_4x5_1080x1350.jpg", "k_2_4x5_1080x1350.jpg"], "originals are not taken for studio images");
  const d = good();
  d.look = "original";
  d.slides = slidesFor("original", f);
  assert.deepEqual(planPosts(d, f), [
    { kind: "carousel", files: ["k_1_original_4x5_1080x1350.jpg", "k_2_original_4x5_1080x1350.jpg"] },
    { kind: "story", files: ["k_1_original_story_9x16_1080x1920.jpg"] },
  ]);
  assert.deepEqual(draftProblems(d, f), []);
  d.look = "studio";
  assert.equal(storyFile(d, f), "k_1_story_9x16_1080x1920.jpg");
  assert.deepEqual(slidesFor("studio", f), ["k_1_4x5_1080x1350.jpg", "k_1_closeup_4x5_1080x1350.jpg"]);
  // A piece the AI marked as skipped stays skipped with either look.
  assert.deepEqual(draftProblems({ ...d, look: "original", marked: true }, f), ["Skipped: this piece can't be posted from here."]);
});

test("the Claude-styled look: slides, Story and Post use its own images", async () => {
  const { slidesFor } = await import("../src/lib/kitDraft.ts");
  const f = sortKitFiles([...files.main, ...files.closeup, ...files.story, "k_1_claude_4x5_1080x1350.jpg", "k_1_claude_closeup_4x5_1080x1350.jpg", "k_1_claude_story_9x16_1080x1920.jpg"]);
  assert.deepEqual(f.main, ["k_1_4x5_1080x1350.jpg", "k_2_4x5_1080x1350.jpg"], "styled images are not taken for the studio ones");
  const d = good();
  d.look = "claude";
  d.slides = slidesFor("claude", f);
  assert.deepEqual(planPosts(d, f), [
    { kind: "carousel", files: ["k_1_claude_4x5_1080x1350.jpg", "k_1_claude_closeup_4x5_1080x1350.jpg"] },
    { kind: "story", files: ["k_1_claude_story_9x16_1080x1920.jpg"] },
  ]);
  assert.deepEqual(draftProblems(d, f), []);
});
