import test from "node:test";
import assert from "node:assert/strict";
import { parseProductPatch } from "../src/lib/patch.ts";

const ok = (input: unknown) => {
  const r = parseProductPatch(input);
  assert.ok(r.ok, `should accept ${JSON.stringify(input)}`);
  return r.ok ? r.data : {};
};
const bad = (input: unknown) => assert.equal(parseProductPatch(input).ok, false, `should reject ${JSON.stringify(input)}`);

test("rejects the bypasses found in review", () => {
  bad({ status: "ready", price_cad: "abc" });
  bad({ status: "Ready" });
  bad({ status: "READY " });
  bad({ captions: "x" });
  bad({ name: 5 });
  bad({ category: "undefined" });
  bad({ category: 7 });
  bad({ price_cad: Number.NaN });
  bad({ price_cad: -1 });
  bad({ hashtags: [1, 2] });
  bad({ nickel_free: "yes" });
});

test("accepts what the editor sends and cleans it", () => {
  assert.deepEqual(ok({ price_cad: 34.5 }), { price_cad: 34.5 });
  assert.deepEqual(ok({ price_cad: "34.5" }), { price_cad: 34.5 });
  assert.deepEqual(ok({ price_cad: "" }), { price_cad: null });
  assert.deepEqual(ok({ price_cad: null }), { price_cad: null });
  assert.deepEqual(ok({ status: "ready", hashtags: ["#a"] }), { status: "ready", hashtags: ["#a"] });
  assert.deepEqual(ok({ nickel_free: null, stock_qty: 3 }), { nickel_free: null, stock_qty: 3 });
});

test("drops fields the editor must not change", () => {
  const d = ok({ id: 99, sku: "EFJ-XX-1", created_at: "x", analysed_at: "y", name: "Aria" });
  assert.deepEqual(d, { name: "Aria" });
});

test("a missing key stays missing", () => {
  assert.deepEqual(ok({}), {});
  assert.ok(!("price_cad" in ok({ name: "A" })));
});
