// One BiRefNet cutout in its own process, so running out of memory can never take the Studio down.
// Used by isolatedCutout() in src/lib/localCutout.ts:  node scripts/cutout-one.mts <input.jpg> <output.png>
// Writes the PNG and prints one line of JSON ({ coverage, via, ms }). Exit code 3 means out of memory.
import { register } from "node:module";
import fs from "node:fs";

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

const [inFile, outFile] = process.argv.slice(2);
const oom = (e: unknown) => /bad alloc|out of memory|failed to allocate|std::bad_alloc/i.test(String(e instanceof Error ? e.message : e));
const die = (e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(oom(e) ? 3 : 1);
};
process.on("uncaughtException", die).on("unhandledRejection", die);

const { localCutout } = await import("../src/lib/localCutout.ts");
try {
  // Tests: behave like the model running out of memory, without needing 5 GB.
  if (process.env.EFJ_CUTOUT_SIMULATE === "oom") throw new Error("Non-zero status code returned while running GatherND node. Status Message: bad allocation");
  const r = await localCutout(fs.readFileSync(inFile));
  fs.writeFileSync(outFile, r.png);
  console.log(JSON.stringify({ coverage: r.coverage, via: r.via, ms: r.ms }));
} catch (e) {
  die(e);
}
