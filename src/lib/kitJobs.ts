import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { startJob, runningJob, type Job, type JobContext } from "./jobs";
import { appendLog, hasSource, kitDir, kitFiles, listTracks, makeOriginals, postedGroups, readKit, readLog, saveDraft, snapshotStudio } from "./kits";
import { draftProblems, finalAlts, finalCaption, planPosts, storyFile, type Draft, type LogEntry } from "./kitDraft";
import { withPublicFiles } from "./publicShare";
import { publishPost } from "./providers/instagram";
import { buildReel } from "./reel";
import { nextRecipe, nextTrack, recipeLabel } from "./reelRecipes";
import { addReel, nextReelFile, readReels } from "./reelVariants";
import { generateAiScenes, type AiStyle } from "./aiScene";
import { localModelPath } from "./localCutout";
import { writePost } from "./aiPost";
import { askForStyle } from "./claudeStyle";

/**
 * The Instagram page's long steps, each run as a job (lib/jobs.ts) the page polls. Server-only.
 * - kit: runs scripts/instagram-kit.mts (the same BiRefNet cutout and studio templates as `npm run insta`) on the uploaded photos.
 * - regen: makes the studio images again with another backdrop, keeping the current ones.
 * - reel: builds the Reel with sound (lib/reel.ts); "Create Reel" picks a new style and track each time.
 * - ai: AI scenes from Gemini, only when the owner presses the button (lib/aiScene.ts).
 * - publish: the same tunnel and publish steps as `npm run ig:publish -- <kit> --confirm`.
 */

export type StartResult = { job: Job } | { error: string; problems?: string[]; status: number };

/** Runs scripts/instagram-kit.mts on the kit's uploaded photos, with its progress lines in the job. */
/** Line breaks in the script's output (Windows or Unix). */
const NEWLINE = /\r?\n/;

function runKitScript(ctx: JobContext, slug: string, extra: string[]): Promise<void> {
  const dir = kitDir(slug)!;
  return new Promise<void>((resolve, reject) => {
    const args = ["--no-warnings", path.join(process.cwd(), "scripts", "instagram-kit.mts"), path.join(dir, ".source"), slug, ...extra];
    const p = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let partial = "", last = "";
    const take = (d: Buffer) => {
      const parts = (partial + String(d)).split(NEWLINE);
      partial = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) ctx.log((last = line));
    };
    p.stdout!.on("data", take);
    p.stderr!.on("data", take);
    p.once("error", (e) => reject(new Error(`Could not start the kit script (${e.message}).`)));
    p.once("exit", (code) => {
      if (partial.trim()) ctx.log((last = partial));
      if (code !== 0) return reject(new Error(/memory/i.test(last) ? last : "Making the images failed. See the lines above."));
      resolve();
    });
  });
}

/**
 * Asks Claude for a layout and renders the Claude-styled version from the cached cutout. A flagged photo gets no Claude
 * version; a stamped mark skips the whole piece (Post off), and is never described.
 */
async function styleWithClaude(ctx: JobContext, slug: string): Promise<void> {
  ctx.log("Asking Claude for a styled version…");
  const r = await askForStyle(slug);
  if (r.status === "ok") {
    const { template, ...style } = r.style;
    await runKitScript(ctx, slug, ["--variant", "claude", "--template", template, "--style", JSON.stringify(style)]);
    ctx.log("Claude-styled version ready.");
    return;
  }
  // No Claude version for this photo: drop any earlier one (it is kept for "Previous version" when there was one).
  const dir = kitDir(slug)!;
  const f = kitFiles(slug);
  for (const n of [...f.claude, ...f.claudeCloseup, ...f.claudeStory]) fs.rmSync(path.join(dir, n), { force: true });
  if (r.status === "skipped") {
    ctx.log(r.mark ? "Skipped." : `Claude version skipped: ${r.reason}.`);
    if (r.mark) {
      const kit = readKit(slug);
      if (kit) saveDraft(slug, { ...kit.draft, marked: true });
    }
  } else {
    ctx.log(r.reason);
  }
}

export function startKit(slug: string, opts: { dropDark: boolean; name: string }): StartResult {
  const dir = kitDir(slug);
  if (!dir) return { error: "Unknown kit.", status: 400 };
  if (runningJob(slug, "kit")) return { error: "This kit is already being made.", status: 409 };
  if (!localModelPath()) return { error: "The local cutout model isn't installed. Run: node scripts/get-birefnet.mjs lite", status: 503 };
  const job = startJob("kit", slug, async (ctx) => {
    await runKitScript(ctx, slug, opts.dropDark ? ["--drop-dark"] : []);
    await makeOriginals(slug);
    // Then the AI writes the caption, hashtags and alt text. The owner's edits on the page start from this draft.
    const kit = readKit(slug);
    if (!kit) return;
    ctx.log("Writing the caption, hashtags and alt text…");
    const draft = await writePost(slug, kit.draft, { name: opts.name });
    saveDraft(slug, draft);
    ctx.log(draft.aiNote);
    await styleWithClaude(ctx, slug);
  });
  return { job };
}

/** Backdrops the owner can pick when making the studio images again (ids from scripts/instagram-kit.mts). */
export const BACKDROPS = ["auto", "ivory", "gilded-frame", "blush-arch", "noir", "stone", "horizon", "sage-frame"] as const;

/**
 * Makes the studio images again from the uploaded photos with another backdrop. The cutout is cached from the first run,
 * so this takes seconds and needs no extra memory. The jewellery's pixels are never changed. The current images are kept,
 * so the owner can go back. The caption is left as it is.
 */
export function startRegenerate(slug: string, opts: { backdrop: (typeof BACKDROPS)[number]; dropDark: boolean; claude?: boolean }): StartResult {
  if (!kitDir(slug) || !hasSource(slug)) return { error: "This kit has no uploaded photos to make again.", status: 400 };
  for (const k of ["kit", "regen", "reel", "publish", "ai"] as const) if (runningJob(slug, k)) return { error: "Wait for the current step to finish first.", status: 409 };
  const job = startJob("regen", slug, async (ctx) => {
    snapshotStudio(slug);
    ctx.log("Kept the current images, so you can go back to them.");
    // The Claude-styled look asks Claude again for a different layout; the studio look uses the chosen backdrop.
    if (opts.claude) await styleWithClaude(ctx, slug);
    else await runKitScript(ctx, slug, ["--template", opts.backdrop, ...(opts.dropDark ? ["--drop-dark"] : [])]);
  });
  return { job };
}

/** Why a Reel can't be started now, if it can't. Uses the stored draft's skip flag, never the page's copy. */
function reelBlocked(slug: string): { error: string; status: number } | null {
  const kit = kitDir(slug) ? readKit(slug) : null;
  if (!kit) return { error: "Unknown kit.", status: 400 };
  if (kit.draft.marked) return { error: "Skipped: this piece can't be posted from here.", status: 400 };
  if (runningJob(slug, "reel")) return { error: "The Reel is already being made.", status: 409 };
  if (runningJob(slug, "publish")) return { error: "This kit is being published right now.", status: 409 };
  for (const k of ["kit", "regen", "ai"] as const) if (runningJob(slug, k)) return { error: "Wait for the current step to finish first.", status: 409 };
  return null;
}

export function startReel(slug: string, draft: Draft): StartResult {
  const blocked = reelBlocked(slug);
  if (blocked) return blocked;
  const story = storyFile(draft, kitFiles(slug));
  return { job: startJob("reel", slug, (ctx) => buildReel({ slug, slides: draft.slides, track: draft.track, story }, ctx.log)) };
}

/**
 * "Create Reel": a different style from the last Reel, and a different track when there is more than one (or none when
 * muted). The new Reel becomes the chosen one; the last three are kept to pick from.
 */
export function startCreateReel(slug: string, draft: Draft): StartResult {
  const blocked = reelBlocked(slug);
  if (blocked) return blocked;
  const kept = readReels(slug).items;
  const last = kept[kept.length - 1];
  const music = nextTrack(listTracks(), last?.track, draft.mute);
  if ("error" in music) return { error: music.error, status: 400 };
  const recipe = nextRecipe(last?.recipe);
  const story = storyFile(draft, kitFiles(slug));
  const out = nextReelFile(slug);
  const job = startJob("reel", slug, async (ctx) => {
    await buildReel({ slug, slides: draft.slides, track: music.track, story, recipe, fields: draft.fields, out }, ctx.log);
    addReel(slug, { file: out, recipe, track: music.track, at: new Date().toISOString() });
    const result = { file: out, recipe, label: recipeLabel(recipe), track: music.track };
    ctx.log(`Style: ${result.label}. Track: ${music.track ?? "none (muted)"}.`);
    return result;
  });
  return { job };
}

/** AI scenes from Gemini, started only by the owner's button. The draft (what is selected) is left as it is. */
export function startAiScene(slug: string, opts: { count: 1 | 2; style: AiStyle }): StartResult {
  if (!kitDir(slug) || !readKit(slug)) return { error: "Unknown kit.", status: 400 };
  if (readKit(slug)!.draft.marked) return { error: "Skipped: this piece can't be posted from here.", status: 400 };
  for (const k of ["kit", "regen", "reel", "publish", "ai"] as const) if (runningJob(slug, k)) return { error: "Wait for the current step to finish first.", status: 409 };
  return { job: startJob("ai", slug, (ctx) => generateAiScenes(slug, opts, ctx.log)) };
}

const LABEL: Record<LogEntry["kind"], string> = { image: "photo post", carousel: "carousel post", reel: "Reel", story: "Story" };

export interface PublishedItem {
  kind: LogEntry["kind"];
  status: LogEntry["status"];
  mediaId?: string;
  permalink?: string;
}

/**
 * Checks the draft again on the server (blanks, banned wording, already posted), then publishes each post once. A post
 * with an unclear answer is logged as "check-instagram" and nothing after it is attempted.
 */
export function startPublish(slug: string, draft: Draft): StartResult {
  const dir = kitDir(slug);
  if (!dir || !readKit(slug)) return { error: "Unknown kit.", status: 400 };
  if (runningJob(slug, "publish")) return { error: "This kit is already being published.", status: 409 };
  if (runningJob(slug, "reel") || runningJob(slug, "regen")) return { error: "Wait for the current step to finish first.", status: 409 };
  const files = kitFiles(slug);
  const problems = draftProblems(draft, files, postedGroups(readLog(slug)));
  if (problems.length) return { error: "Fix these first.", problems, status: 400 };
  saveDraft(slug, draft);
  const plan = planPosts(draft, files);
  const caption = finalCaption(draft);
  const alts = finalAlts(draft);

  const job = startJob("publish", slug, async (ctx) => {
    const done: PublishedItem[] = [];
    const all = [...new Set(plan.flatMap((p) => p.files))];
    await withPublicFiles(
      dir,
      all,
      async (urls) => {
        const urlOf = new Map(all.map((f, i) => [f, urls[i]]));
        for (const p of plan) {
          ctx.log(`Publishing the ${LABEL[p.kind]}…`);
          const r = await publishPost(
            p.kind === "reel"
              ? { kind: "reel", imageUrls: [], videoUrl: urlOf.get(p.files[0]), caption }
              : { kind: p.kind, imageUrls: p.files.map((f) => urlOf.get(f)!), caption: p.kind === "story" ? "" : caption, altTexts: p.kind === "story" ? [] : alts }
          );
          if (r.ok || r.unknown) {
            const entry: LogEntry = { at: new Date().toISOString(), kind: p.kind, files: p.files, status: r.ok ? "published" : "check-instagram", mediaId: r.mediaId, permalink: r.permalink };
            appendLog(slug, entry);
            done.push({ kind: p.kind, status: entry.status, mediaId: r.mediaId, permalink: r.permalink });
            ctx.setResult(done);
          }
          if (r.ok) {
            ctx.log(`Published the ${LABEL[p.kind]}: ${r.permalink ?? `media id ${r.mediaId}`}`);
            continue;
          }
          if (r.unknown) throw new Error(`No clear answer for the ${LABEL[p.kind]}, so it may be live. Check Instagram before trying again. Nothing after it was attempted.`);
          throw new Error(`The ${LABEL[p.kind]} was not published: ${r.error}${done.length ? "" : " Nothing was posted."}`);
        }
      },
      ctx.log
    );
    return done;
  });
  return { job };
}
