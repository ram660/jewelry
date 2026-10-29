import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

// A stand-in model file, so the cutout counts as installed. The worker is told to fail before it would load it.
const models = fs.mkdtempSync(path.join(os.tmpdir(), "efj-models-"));
fs.writeFileSync(path.join(models, "birefnet-lite.onnx"), "stand-in");
process.env.EFJ_MODEL_DIR = models;
process.env.EFJ_CUTOUT_RETRY_MS = "10";
test.after(() => fs.rmSync(models, { recursive: true, force: true }));

const { isolatedCutout, OUT_OF_MEMORY, LocalCutoutError } = await import("../src/lib/localCutout.ts");

test("the model running out of memory fails only its own process: a clear message, tried twice, the caller keeps running", async () => {
  process.env.EFJ_CUTOUT_SIMULATE = "oom";
  const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("efj-cutout-")).length;
  const t0 = Date.now();
  await assert.rejects(isolatedCutout(Buffer.from("not really a photo")), (e: unknown) => e instanceof LocalCutoutError && e.message === OUT_OF_MEMORY);
  assert.ok(Date.now() - t0 >= 10, "it waited before the second try");
  // This process is still alive and can run the next job; the temp folder is gone.
  assert.equal(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("efj-cutout-")).length, before);
  await assert.rejects(isolatedCutout(Buffer.from("again")), /Not enough free memory/);
  delete process.env.EFJ_CUTOUT_SIMULATE;
});

test("any other failure is reported as it is, not as a memory problem", async () => {
  await assert.rejects(isolatedCutout(Buffer.from("not a photo at all")), (e: unknown) => e instanceof LocalCutoutError && e.message !== OUT_OF_MEMORY);
});
