import test from "node:test";
import assert from "node:assert/strict";
import { parseStockLink, searchLink, mentionsAny, isAiGenerated } from "../src/lib/providers/stock.ts";

test("Pexels links", () => {
  assert.deepEqual(parseStockLink("https://www.pexels.com/photo/gold-necklace-1395306/"),
    { site: "pexels", kind: "photo", media: "image", value: "1395306" });
  assert.deepEqual(parseStockLink("https://www.pexels.com/en-ca/photo/gold-necklace-1395306/"),
    { site: "pexels", kind: "photo", media: "image", value: "1395306" });
  assert.deepEqual(parseStockLink("https://www.pexels.com/search/fashion%20jewelry/"),
    { site: "pexels", kind: "search", media: "image", value: "fashion jewelry" });
  assert.deepEqual(parseStockLink("https://www.pexels.com/search/videos/gold%20ring/"),
    { site: "pexels", kind: "search", media: "video", value: "gold ring" });
  assert.deepEqual(parseStockLink("https://www.pexels.com/video/woman-wearing-earrings-8000001/"),
    { site: "pexels", kind: "photo", media: "video", value: "8000001" });
  assert.equal(parseStockLink("https://www.pexels.com/collections/jewelry-kqkzbuq/")?.value, "kqkzbuq");
});

test("Pixabay links", () => {
  assert.deepEqual(parseStockLink("https://pixabay.com/images/search/fashion%20jewelry/?orientation=vertical"),
    { site: "pixabay", kind: "search", media: "image", value: "fashion jewelry", orientation: "vertical" });
  assert.deepEqual(parseStockLink("https://pixabay.com/photos/necklace-jewelry-gold-1234567/"),
    { site: "pixabay", kind: "photo", media: "image", value: "1234567" });
  assert.equal(parseStockLink("https://pixabay.com/videos/search/necklace/")?.media, "video");
});

test("Unsplash links", () => {
  assert.deepEqual(parseStockLink("https://unsplash.com/s/photos/fashion-jewelery"),
    { site: "unsplash", kind: "search", media: "image", value: "fashion jewelery" });
  assert.equal(parseStockLink("https://unsplash.com/photos/gold-ring-AbCdEf12345")?.value, "AbCdEf12345");
});

test("anything else is refused", () => {
  for (const bad of ["https://www.google.com/search?q=rings&tbm=isch", "https://example.com/a.jpg", "not a link", "javascript:alert(1)"]) {
    assert.equal(parseStockLink(bad), null, bad);
  }
});

test("search shorthand round-trips", () => {
  for (const site of ["pexels", "pixabay", "unsplash"] as const) {
    const link = parseStockLink(searchLink(site, "pearl earrings"));
    assert.equal(link?.site, site);
    assert.equal(link?.value, "pearl earrings");
  }
  assert.equal(parseStockLink(searchLink("pixabay", "necklace", "video"))?.media, "video");
});

test("off-topic filter", () => {
  assert.equal(mentionsAny("basketball, hoop, sport", ["necklace", "earring"]), false);
  assert.equal(mentionsAny("gold, Earrings, fashion", ["earring"]), true);
  assert.equal(mentionsAny("anything", []), true);
});

test("AI-generated results are recognised", () => {
  assert.equal(isAiGenerated({ description: "ai generated, ring, gold, loop" }), true);
  assert.equal(isAiGenerated({ description: "AI-generated necklace" }), true);
  assert.equal(isAiGenerated({ description: "gold, chain, said, hair" }), false);
});
