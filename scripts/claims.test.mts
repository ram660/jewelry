// Run with: npm test   (Node's built-in test runner; no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { checkProduct, claimProblems, scanHashtag, scanText } from "../src/lib/claims.ts";
import type { Product } from "../src/lib/types.ts";

const blocked = (s: string) => assert.ok(scanText(s).length > 0, `should block: ${s}`);
const allowed = (s: string) => assert.deepEqual(scanText(s), [], `should allow: ${s}`);

test("blocks claims the old patterns missed", () => {
  for (const s of [
    "solid gold chain", "solid-gold ring", "real gold", "authentic gold", "100% gold", "gold throughout",
    "10K gold", "10 karat gold", "10-karat gold", "10K earrings", "10K-gold ring",
    "14 karat", "18-karat", "18 carat gold", "14ct", "9K", "12K",
    "waterproof", "water-resistant", "sweatproof", "shower-safe", "safe to shower",
    "tarnish-free", "doesn't tarnish", "does not tarnish", "won’t tarnish", "non-tarnish", "never fades",
    "lasts forever", "a lifetime of shine", "everlasting shine", "heirloom quality", "built to last",
    "hypoallergenic", "allergy-free", "skin-safe", "won't turn your skin green", "nickel-free",
    "10Κ gold", // Greek Kappa look-alike
    "10K gol­d", // soft hyphen inside the word
  ]) blocked(s);
});

test("allows honest wording", () => {
  for (const s of [
    "10K gold-plated", "10K gold plated ring", "10K GP", "A 10K gold-plated chain in warm yellow gold.",
    "Take it off before showering and swimming.", "Wipe with a soft dry cloth.", "Plating wears over time.",
    "Rose gold and yellow gold tones", "Size 18 inch chain", "Put it on last, take it off first.",
  ]) allowed(s);
});

test("saying it is NOT solid gold is allowed, claiming it is solid gold is not", () => {
  allowed("It's 10K gold-plated, not solid gold.");
  allowed("This piece isn't solid gold.");
  allowed("It is not solid-gold, it is plated.");
  blocked("solid gold");
  blocked("Real solid gold chain");
  blocked("it is solid gold, not plated");
  blocked("nothing but solid gold");
});

test("confirmed facts unlock their own claim only", () => {
  assert.ok(scanText("hypoallergenic").length > 0);
  assert.deepEqual(scanText("hypoallergenic", { hypoallergenic: true }), []);
  assert.ok(scanText("nickel-free", { hypoallergenic: true }).length > 0);
  assert.deepEqual(scanText("nickel-free", { nickel_free: true }), []);
  assert.ok(scanText("hypoallergenic", { hypoallergenic: null }).length > 0);
});

test("hashtags are scanned", () => {
  for (const t of ["#solidgold", "#14kgold", "#18k", "#waterproof", "#TarnishFree", "#10kgold"]) {
    assert.ok(scanHashtag(t).length > 0, `should block ${t}`);
  }
  for (const t of ["#goldplatedjewellery", "#10kgoldplated", "#ElegantFashionJewellery", "#yvrstyle", "#2024k"]) {
    assert.deepEqual(scanHashtag(t), [], `should allow ${t}`);
  }
});

const base: Product = {
  id: 1, sku: "EFJ-RG-0001", name: "Aria Ring", category: "ring", subcategory: "", gender: "women",
  plating: "10K gold-plated", base_metal: "", plating_microns: "", nickel_free: null, colour_finish: "",
  stones: "", sizes: "", weight_g: null, price_cad: 40, cost_cad: null, compare_at_cad: null, stock_qty: 1,
  low_stock_at: 3, status: "draft", hypoallergenic: null, anti_tarnish: null, style_tags: [], occasion_tags: [],
  name_suggestions: [], short_desc: "", long_desc: "", care_notes: "", captions: [], hashtags: [], alt_text: "",
  owner_questions: [], analysed_at: null, created_at: "", updated_at: "",
};
const blockers = (p: Product, n = 1) => checkProduct(p, n).filter((x) => x.level === "block");

test("a clean product passes", () => assert.deepEqual(blockers(base), []));

test("price must be a real positive number", () => {
  for (const bad of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "abc" as unknown as number]) {
    assert.ok(blockers({ ...base, price_cad: bad }).some((b) => /price/i.test(b.message)), `price ${String(bad)}`);
  }
});

test("needs an approved photo and proper plating", () => {
  assert.ok(blockers(base, 0).some((b) => /photo/i.test(b.message)));
  assert.ok(blockers({ ...base, plating: "10K gold, not plated" }).length > 0);
  assert.ok(blockers({ ...base, plating: "gold plated" }).length > 0);
});

test("scans hashtags, finish, stones, tags and demo markers", () => {
  assert.ok(claimProblems({ ...base, hashtags: ["#solidgold"] }).length > 0);
  assert.ok(claimProblems({ ...base, colour_finish: "real gold" }).length > 0);
  assert.ok(claimProblems({ ...base, name_suggestions: ["Waterproof Ring"] }).length > 0);
  assert.ok(claimProblems({ ...base, captions: ["[DEMO] Everyday elegance 10K gold-plated"] }).length > 0);
});

test("malformed list fields do not throw", () => {
  const weird = { ...base, captions: "x", hashtags: null, style_tags: 5, name: 5 } as unknown as Product;
  assert.doesNotThrow(() => checkProduct(weird, 1));
});
