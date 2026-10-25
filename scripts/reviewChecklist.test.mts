import test from "node:test";
import assert from "node:assert/strict";
import { checklistFor, needsChecklist } from "../src/lib/reviewChecklist.ts";
import { CATEGORIES } from "../src/lib/types.ts";
import { scanText } from "../src/lib/claims.ts";

test("only cutout and generated pictures need a checklist", () => {
  for (const k of ["clean", "scene", "on_model", "scale"]) assert.ok(needsChecklist(k), k);
  for (const k of ["original", "enhanced", "price_card"]) assert.equal(checklistFor("ring", k).length, 0, k);
});

test("earrings get a symmetry check, rings do not", () => {
  assert.ok(checklistFor("earring", "scene").some((l) => /symmetry/i.test(l)));
  assert.ok(!checklistFor("ring", "scene").some((l) => /symmetry/i.test(l)));
});

test("every category and an unknown one still get the common checks", () => {
  for (const c of [...CATEGORIES, "mystery"]) assert.ok(checklistFor(c, "on_model").length >= 3, c);
});

test("checklist wording passes the banned-claims scan", () => {
  for (const c of CATEGORIES)
    for (const k of ["clean", "scene", "on_model", "scale"])
      for (const line of checklistFor(c, k)) assert.deepEqual(scanText(line, {}), [], line);
});
