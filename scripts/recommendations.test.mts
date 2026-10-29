import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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

const { readRecommendations, addToCaption, usePrice, fillFromFact, pricePosition, lineOk } = await import("../src/lib/recommendations.ts");

const base = {
  generatedAt: "2026-10-28",
  price: { currency: "USD", low: 22.5, median: 49, high: 79.99, count: 6, note: "Similar sets." },
  suggestedPriceCAD: { low: 35, high: 70, note: "Rough conversion." },
  descriptionIdeas: ["Say it is a set.", "A dupe of the famous one ✨", "Waterproof and lasts forever"],
  productFacts: [
    { label: "Chain length", value: "45 cm", confirmed: false },
    { label: "Maker", value: "Brand® Paris", confirmed: true },
  ],
  toConfirm: ["Chain length", "Inspired by a designer piece"],
  sources: ["Online search"],
  extra: "ignored",
};

test("no file means 'none'; a malformed one is 'invalid', not a crash", () => {
  assert.deepEqual(readRecommendations(null), { status: "none" });
  assert.deepEqual(readRecommendations({ generatedAt: 5 }), { status: "invalid" });
  assert.deepEqual(readRecommendations({ ...base, price: { low: "cheap" } }), { status: "invalid" });
  assert.deepEqual(readRecommendations("just text"), { status: "invalid" });
});

test("lines with brand-like or banned wording are dropped one by one; the rest stays", () => {
  const r = readRecommendations(base);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.deepEqual(r.data.descriptionIdeas, ["Say it is a set."]);
  assert.deepEqual(r.data.productFacts.map((f) => f.label), ["Chain length"]);
  assert.deepEqual(r.data.toConfirm, ["Chain length"]);
  assert.equal(r.dropped, 4);
  assert.ok(!JSON.stringify(r).includes("ignored"), "unknown fields are left out");
  for (const s of ["designer look", "™ logo", "Example & Co style"]) assert.equal(lineOk(s), false, s);
  assert.equal(lineOk("10K gold-plated, red enamel"), true);
});

test("a price range upside down is left out rather than shown wrong", () => {
  const r = readRecommendations({ ...base, suggestedPriceCAD: { low: 80, high: 30, note: "" } });
  assert.equal(r.status === "ok" && r.data.suggestedPriceCAD, null);
});

test("the buttons only change the one field they are for", () => {
  assert.deepEqual(usePrice(35), { price: "35" });
  assert.deepEqual(usePrice(49.5), { price: "49.50" });
  const caption = "Lucky clovers ✨\n\nA fine chain with five charms.\n\n$[PRICE] CAD. Comment ✨ and we'll DM you the details.";
  assert.equal(addToCaption(caption, "A set: necklace plus studs."), "Lucky clovers ✨\n\nA fine chain with five charms.\n\nA set: necklace plus studs.\n\n$[PRICE] CAD. Comment ✨ and we'll DM you the details.");
  assert.equal(addToCaption("Just a line", "Idea"), "Just a line\n\nIdea");
  assert.deepEqual(fillFromFact({ label: "Chain length", value: "45 cm", confirmed: false }), { length: "45 cm" });
  assert.deepEqual(fillFromFact({ label: "How to order", value: "DM us", confirmed: true }), { order: "DM us" });
  assert.equal(fillFromFact({ label: "Chain length", value: "", confirmed: false }), null, "nothing to fill");
  assert.equal(fillFromFact({ label: "Pieces", value: "Necklace", confirmed: true }), null, "no field for it");
  assert.equal(pricePosition(35, 35, 70), 0);
  assert.equal(pricePosition(100, 35, 70), 1);
});

test("the clover set's file reads; its tarnish/skin lines are dropped by the wording check", () => {
  const raw = JSON.parse(fs.readFileSync(new URL("../instagram/clover-set/recommendations.json", import.meta.url), "utf8"));
  const r = readRecommendations(raw);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.deepEqual(r.data.suggestedPriceCAD && [r.data.suggestedPriceCAD.low, r.data.suggestedPriceCAD.high], [35, 70]);
  assert.equal(r.data.descriptionIdeas.length, 5);
  assert.ok(!r.data.productFacts.some((f) => /hypoallergenic/i.test(f.label)));
});
