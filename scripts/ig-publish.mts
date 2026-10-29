// Publish a finished Instagram kit (from `npm run insta`) to the shop's Instagram account.
//
//   npm run ig:publish -- <kit>                     dry run: shows exactly what would be posted, sends nothing
//   npm run ig:publish -- <kit> --confirm           publishes it
//   npm run ig:publish -- --tunnel-test <kit>       checks the image server and tunnel, posts nothing
//
// <kit> is a folder name under instagram/ (e.g. heart-studs) or a path to one.
// Options: --caption N (default 1), --single (main photo only, no carousel), --no-story, --story-only,
//          --again (publish a kit that was already published).
//
// How the images reach Instagram: see src/lib/publicShare.ts. For one publish only, the JPEGs are served from a tiny
// server on 127.0.0.1 through a Cloudflare quick tunnel to that server alone. The Studio itself is never exposed. The
// tunnel, the server and the temp copies are removed afterwards, also on errors and Ctrl+C.
// The publish request goes to the running Studio (npm run dev), which holds the token. This script holds no keys.
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";

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

const { parsePostNotes, fullCaption, postProblems } = await import("../src/lib/postNotes.ts");
const { withPublicFiles } = await import("../src/lib/publicShare.ts");
const { postGroup } = await import("../src/lib/kitDraft.ts");

const STUDIO = (process.env.EFJ_URL || "http://localhost:3000").replace(/\/+$/, "");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const kitArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--caption");

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!kitArg) fail("Usage: npm run ig:publish -- <kit-folder> [--caption N] [--single] [--no-story] [--story-only] [--confirm]");
const kitDir = fs.existsSync(kitArg) ? path.resolve(kitArg) : path.resolve(process.env.EFJ_INSTA_DIR || "instagram", kitArg);
if (!fs.statSync(kitDir, { throwIfNoEntry: false })?.isDirectory()) fail(`No kit folder at ${kitDir}.`);
const files = fs.readdirSync(kitDir).sort();
const pick = (re: RegExp) => files.find((f) => re.test(f));
const main = pick(/_\d+_4x5_1080x1350\.jpe?g$/i);
const closeup = pick(/_\d+_closeup_4x5_1080x1350\.jpe?g$/i);
const story = pick(/_\d+_story_9x16_1080x1920\.jpe?g$/i);
const notesFile = pick(/_post-notes\.md$/i);
if (!main) fail(`No 4:5 main image (*_4x5_1080x1350.jpg) in ${kitDir}.`);
if (!notesFile) fail(`No *_post-notes.md in ${kitDir}.`);

const notes = parsePostNotes(fs.readFileSync(path.join(kitDir, notesFile), "utf8"));
const n = Number(value("--caption") ?? 1);
if (!(Number.isInteger(n) && n >= 1)) fail("--caption takes a number, e.g. --caption 2");
if (!notes.captions.length) fail("No caption found under '## Caption' in the post notes.");
if (n > notes.captions.length) fail(`There are only ${notes.captions.length} caption(s) in the post notes.`);
const caption = fullCaption(notes.captions[n - 1], notes.hashtags);

type Post = { kind: "image" | "carousel" | "story"; files: string[]; altTexts: string[] };
const posts: Post[] = [];
if (!flags.has("--story-only")) {
  const feed = closeup && !flags.has("--single") ? [main, closeup] : [main];
  const alts = [notes.alt.slide1, notes.alt.slide2].slice(0, feed.length).map((a) => a ?? "");
  posts.push({ kind: feed.length > 1 ? "carousel" : "image", files: feed, altTexts: alts });
}
if (story && !flags.has("--no-story")) posts.push({ kind: "story", files: [story], altTexts: [] });
if (!posts.length) fail("Nothing to publish (no Story image in this kit).");

const feedPost = posts.find((p) => p.kind !== "story");
const problems = feedPost ? postProblems(caption, feedPost.altTexts.filter(Boolean)) : [];
const logFile = path.join(kitDir, `${path.basename(kitDir)}_published.json`);
type LogEntry = { at: string; kind: Post["kind"] | "reel"; files: string[]; status: "published" | "check-instagram"; mediaId?: string; permalink?: string };
const log: LogEntry[] = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : [];

// ---- Preview (always shown) ----
console.log(`Kit: ${path.basename(kitDir)}${flags.has("--confirm") ? "" : "   (DRY RUN: nothing is sent)"}`);
for (const p of posts) {
  console.log(`\n${p.kind === "carousel" ? `Feed post: carousel of ${p.files.length}` : p.kind === "image" ? "Feed post: single image" : "Story"}`);
  p.files.forEach((f, i) => console.log(`  ${i + 1}. ${f}${p.altTexts[i] ? `\n     alt: ${p.altTexts[i]}` : p.kind === "story" ? "" : "\n     alt: (none)"}`));
}
if (feedPost) console.log(`\nCaption ${n} of ${notes.captions.length}, as posted:\n${caption.replace(/^/gm, "  | ")}`);
if (log.length) console.log(`\nAlready in ${path.basename(logFile)}: ${log.map((e) => `${e.kind} ${e.status} ${e.at}`).join("; ")}`);
// The tunnel test posts nothing, so it runs even while the text still needs work.
if (flags.has("--tunnel-test")) {
  await withPublicImages([main], async ([url]) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const bytes = (await r.arrayBuffer()).byteLength;
    console.log(`\nTunnel test passed: ${url.replace(/\/[^/]+$/, "/…")} answered ${r.status} ${r.headers.get("content-type")}, ${bytes} bytes.`);
  }).catch(stop);
  process.exit();
}
if (problems.length) {
  console.log("\nFix before publishing:");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

if (!flags.has("--confirm")) {
  console.log("\nLooks good. To publish it, run the same command with --confirm.");
  process.exit(0);
}
// A Reel made on the Instagram page is its own kind of post, so it doesn't block the photo post or the Story.
const done = posts.filter((p) => log.some((e) => postGroup(e.kind) === postGroup(p.kind)));
if (done.length && !flags.has("--again")) {
  fail(`\nNot published: this kit already has a ${done.map((p) => (p.kind === "story" ? "Story" : "feed post")).join(" and ")} in ${path.basename(logFile)} (published or waiting to be checked). Check Instagram, then add --again if you really want it posted twice.`);
}

// ---- Publish ----
const studioUp = await fetch(STUDIO + "/api/products", { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
if (!studioUp) fail(`The Studio is not running at ${STUDIO}. Start it with npm run dev, then try again.`);

const all = [...new Set(posts.flatMap((p) => p.files))];
await withPublicImages(all, async (urls) => {
  const urlOf = new Map(all.map((f, i) => [f, urls[i]]));
  for (const p of posts) {
    console.log(`\nPublishing the ${p.kind === "story" ? "Story" : "feed post"}…`);
    const res = await fetch(STUDIO + "/api/instagram/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: p.kind, imageUrls: p.files.map((f) => urlOf.get(f)), caption: p.kind === "story" ? "" : caption, altTexts: p.altTexts, confirm: true }),
      signal: AbortSignal.timeout(300_000),
    }).catch((e: unknown) => e as Error);
    const body = res instanceof Error ? null : ((await res.json().catch(() => null)) as { ok?: boolean; unknown?: boolean; mediaId?: string; permalink?: string; error?: string; problems?: string[] } | null);
    const unknown = res instanceof Error || !body || body.unknown;
    if (body?.ok || unknown) {
      log.push({ at: new Date().toISOString(), kind: p.kind, files: p.files, status: body?.ok ? "published" : "check-instagram", mediaId: body?.mediaId, permalink: body?.permalink });
      fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + "\n");
    }
    if (body?.ok) {
      console.log(`Published: ${body.permalink ?? `media id ${body.mediaId}`}`);
      continue;
    }
    if (unknown) throw new Error(`No clear answer, so it may be live. Check Instagram before trying again. (Noted as "check-instagram" in ${path.basename(logFile)}.)`);
    throw new Error(`Not published: ${body!.error}${body!.problems ? `\n  - ${body!.problems.join("\n  - ")}` : ""}`);
  }
}).catch(stop);

/** Errors while the image server and tunnel are up unwind through withPublicImages, so they are shut down before exiting. */
function stop(e: unknown) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}

/** Serves copies of the given kit files at public https addresses for the duration of fn (see src/lib/publicShare.ts). */
function withPublicImages(names: string[], fn: (urls: string[]) => Promise<void>): Promise<void> {
  return withPublicFiles(kitDir, names, fn);
}
