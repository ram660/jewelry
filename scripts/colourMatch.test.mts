import test from "node:test";
import assert from "node:assert/strict";

const { deltaE2000, srgbToLab, maskedMedianLab, toneDifference, describeTone } = await import("../src/lib/colourMatch.ts");

test("CIEDE2000 matches Sharma's reference pairs", () => {
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
  ];
  for (const [x, y, want] of pairs) {
    const got = deltaE2000({ L: x[0], a: x[1], b: x[2] }, { L: y[0], a: y[1], b: y[2] });
    assert.ok(Math.abs(got - want) < 1e-3, `${x} vs ${y}: got ${got}, want ${want}`);
  }
});

test("sRGB white and black convert to the Lab ends", () => {
  const w = srgbToLab(255, 255, 255);
  assert.ok(Math.abs(w.L - 100) < 0.01 && Math.abs(w.a) < 0.01 && Math.abs(w.b) < 0.01);
  assert.ok(Math.abs(srgbToLab(0, 0, 0).L) < 0.01);
});

const fill = (n: number, rgba: number[]) => Uint8Array.from({ length: n * 4 }, (_, i) => rgba[i % 4]);

test("median colour uses only the visible piece", () => {
  const piece = fill(300, [212, 175, 55, 255]);
  const background = fill(1000, [0, 0, 255, 0]);
  const lab = maskedMedianLab(Uint8Array.from([...piece, ...background]));
  const want = srgbToLab(212, 175, 55);
  assert.ok(lab && Math.abs(lab.a - want.a) < 1e-9 && Math.abs(lab.b - want.b) < 1e-9);
  assert.equal(maskedMedianLab(fill(50, [212, 175, 55, 255])), null, "too few pixels");
});

const gold = srgbToLab(212, 175, 55);

test("brightness alone is not a tone change", () => {
  const darker = srgbToLab(150, 124, 39);
  assert.ok(toneDifference(gold, darker) < 3, String(toneDifference(gold, darker)));
  assert.match(describeTone(gold, gold), /matches your photo/);
});

test("yellow gold turning rose is flagged", () => {
  const rose = srgbToLab(205, 140, 120);
  assert.match(describeTone(gold, rose), /clearly different.*rosier/);
});

test("yellow gold turning silver is flagged as paler", () => {
  const silver = srgbToLab(192, 192, 192);
  assert.match(describeTone(gold, silver), /clearly different.*paler, less yellow/);
});

const { labToSrgb, gemWeight, gemMedianLab } = await import("../src/lib/colourMatch.ts");

test("Lab converts back to the same sRGB", () => {
  for (const c of [[190, 35, 40], [212, 175, 55], [30, 140, 80], [40, 60, 170], [0, 0, 0], [255, 255, 255]]) {
    assert.deepEqual(labToSrgb(srgbToLab(c[0], c[1], c[2])), c);
  }
});

test("coloured stones count as stones; gold and neutrals do not", () => {
  for (const c of [[190, 35, 40], [230, 110, 80], [30, 140, 80], [40, 60, 170], [150, 60, 160]]) {
    assert.ok(gemWeight(srgbToLab(c[0], c[1], c[2])) > 0.9, `stone ${c}`);
  }
  for (const c of [[212, 175, 55], [205, 165, 70], [192, 192, 192], [235, 230, 222], [20, 20, 20]]) {
    assert.equal(gemWeight(srgbToLab(c[0], c[1], c[2])), 0, `not a stone ${c}`);
  }
});

test("red pearls turning orange are caught even when gold dominates", () => {
  const piece = (pearl: number[]) => Uint8Array.from([...fill(2000, [212, 175, 55, 255]), ...fill(300, [...pearl, 255])]);
  const was = gemMedianLab(piece([190, 35, 40]))!, now = gemMedianLab(piece([225, 95, 40]))!;
  assert.match(describeTone(was, now, "stones"), /coloured stones are clearly different/);
  assert.match(describeTone(was, was, "stones"), /coloured stones match/);
  assert.equal(gemMedianLab(fill(2000, [212, 175, 55, 255])), null, "plain gold has no stones");
});
