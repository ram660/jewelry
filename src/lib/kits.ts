import fs from "node:fs";
import path from "node:path";
import { parsePostNotes, type PostNotes } from "./postNotes";
import { templateAltText, templateCaptions, templateHashtags } from "./captions";
import { CATEGORIES, type Category } from "./types";
import { Draft, draftFromNotes, postGroup, sortKitFiles, type KitFiles, type LogEntry, type PostGroup } from "./kitDraft";

/**
 * Instagram kits on disk: instagram/<slug>/ holds the images `npm run insta` made, the post notes, the page's draft
 * (<slug>_draft.json) and the publish log (<slug>_published.json). The photos uploaded on the Instagram page are kept in
 * instagram/<slug>/.source/. Server-only.
 */

export const instaDir = () => path.resolve(process.env.EFJ_INSTA_DIR || "instagram");
export const audioDir = () => path.resolve(process.env.EFJ_AUDIO_DIR || "audio");

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** Files the page may read from a kit folder: its own images and Reel, nothing else. */
const KIT_FILE = /^[a-z0-9-]+_[a-z0-9_]+\.(?:jpe?g|mp4)$/i;
const TRACK = /^[\w][\w ().,&'-]{0,150}\.(?:mp3|m4a|aac|wav)$/i;

export const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

export function kitDir(slug: string): string | null {
  if (!SLUG.test(slug)) return null;
  return path.join(instaDir(), slug);
}

/** Absolute path of a kit file, or null if the name isn't one of the kit's images or its Reel. */
export function kitFile(slug: string, name: string): string | null {
  const dir = kitDir(slug);
  if (!dir || !KIT_FILE.test(name) || path.basename(name) !== name) return null;
  return path.join(dir, name);
}

export function trackFile(name: string): string | null {
  if (!TRACK.test(name) || path.basename(name) !== name) return null;
  const full = path.join(audioDir(), name);
  return fs.existsSync(full) ? full : null;
}

export function listTracks(): string[] {
  try {
    return fs.readdirSync(audioDir()).filter((f) => TRACK.test(f)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

const notesPath = (dir: string, slug: string) => path.join(dir, `${slug}_post-notes.md`);
const draftPath = (dir: string, slug: string) => path.join(dir, `${slug}_draft.json`);
const logPath = (dir: string, slug: string) => path.join(dir, `${slug}_published.json`);
export const reelName = (slug: string) => `${slug}_reel_9x16.mp4`;

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

export function readLog(slug: string): LogEntry[] {
  const dir = kitDir(slug);
  return dir ? (readJson<LogEntry[]>(logPath(dir, slug)) ?? []) : [];
}

export function appendLog(slug: string, entry: LogEntry) {
  const dir = kitDir(slug)!;
  const log = readLog(slug);
  log.push(entry);
  fs.writeFileSync(logPath(dir, slug), JSON.stringify(log, null, 2) + "\n");
}

/** Post types already on Instagram for this kit, or waiting to be checked there. */
export const postedGroups = (log: LogEntry[]): PostGroup[] => [...new Set(log.map((e) => postGroup(e.kind)))];

export function kitFiles(slug: string): KitFiles {
  const dir = kitDir(slug);
  let names: string[] = [];
  try { names = dir ? fs.readdirSync(dir).filter((f) => KIT_FILE.test(f)) : []; } catch { /* no folder yet */ }
  return sortKitFiles(names);
}

function readNotes(dir: string, slug: string): PostNotes | null {
  try { return parsePostNotes(fs.readFileSync(notesPath(dir, slug), "utf8")); } catch { return null; }
}

/** What the owner said about the piece when uploading, used for the first captions of a new kit. */
export interface KitMeta {
  name: string;
  category: string;
  /** "gold": 10K gold-plated, confirmed by the owner on upload. "silver": the material still has to be confirmed. */
  finish: "gold" | "silver";
  price: string;
}

const metaPath = (dir: string) => path.join(dir, ".source", "meta.json");
export const readMeta = (slug: string) => {
  const dir = kitDir(slug);
  return dir ? readJson<KitMeta>(metaPath(dir)) : null;
};
export function writeMeta(slug: string, meta: KitMeta) {
  const dir = kitDir(slug)!;
  fs.mkdirSync(path.dirname(metaPath(dir)), { recursive: true });
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Simple captions for a new kit, from the owner's own facts only (no AI). The post notes `npm run insta` writes are a
 * template full of blanks, so these stand in until the owner (or /instagram-kit in Claude Code) writes better ones.
 */
export function templateDraft(meta: KitMeta, files: KitFiles): Draft {
  const plating = meta.finish === "gold" ? "10K gold-plated" : "[CONFIRM FINISH]";
  const price = Number(meta.price.replace(/[$,\s]|CAD/gi, ""));
  const category: Category = (CATEGORIES as readonly string[]).includes(meta.category) ? (meta.category as Category) : "other";
  const facts = { name: meta.name, category, price_cad: price > 0 ? price : null, sizes: "", plating };
  // Without a price, the last paragraph gets a $[PRICE] blank so Post stays off until it is filled in.
  const captions = templateCaptions(facts).map((c) =>
    facts.price_cad ? c : c.replace(/\n\n(?!.*\n\n)/s, "\n\n$$[PRICE] CAD. ")
  );
  const alt = templateAltText(facts);
  const alts: Record<string, string> = {};
  if (files.main[0]) alts[files.main[0]] = alt;
  if (files.closeup[0]) alts[files.closeup[0]] = `Close-up of ${alt.replace(/^Photo of /, "")}`;
  return Draft.parse({
    captions,
    caption: captions[0],
    hashtags: templateHashtags(meta.category).join(" "),
    slides: [files.main[0], files.closeup[0]].filter(Boolean),
    alts,
    fields: { price: facts.price_cad ? String(facts.price_cad) : "", order: "", length: "" },
    category,
    tone: meta.finish,
  });
}

const isTemplateNotes = (n: PostNotes | null) => !n || !n.captions.length || n.captions.every((c) => /\[HOOK LINE\]/i.test(c));

export interface Kit {
  slug: string;
  title: string;
  files: KitFiles;
  draft: Draft;
  log: LogEntry[];
  /** True when the captions are the simple templates rather than written post notes. */
  templateCaptions: boolean;
  /** The uploaded photos are kept, so the studio images can be made again. */
  canRegenerate: boolean;
  /** An earlier version of the studio images is kept. */
  hasPrevious: boolean;
}

export function readKit(slug: string): Kit | null {
  const dir = kitDir(slug);
  if (!dir || !fs.existsSync(dir)) return null;
  const files = kitFiles(slug);
  const notes = readNotes(dir, slug);
  const template = isTemplateNotes(notes);
  const saved = readJson<unknown>(draftPath(dir, slug));
  const parsed = saved ? Draft.safeParse(saved) : null;
  const meta = readMeta(slug);
  const draft = parsed?.success
    ? parsed.data
    : !template && notes
      ? draftFromNotes(notes, files)
      : templateDraft(meta ?? { name: slug.replace(/-/g, " "), category: "other", finish: "gold", price: "" }, files);
  const log = readLog(slug);
  if (!parsed?.success) {
    // A first draft starts with whatever this kit already has on Instagram unticked.
    const posted = postedGroups(log);
    if (posted.includes("feed")) draft.feed = false;
    if (posted.includes("story")) draft.story = false;
  }
  let title = meta?.name || slug.replace(/-/g, " ");
  try {
    const h = fs.readFileSync(notesPath(dir, slug), "utf8").match(/^# (.+?)(?::\s*Instagram post)?\s*$/m);
    if (h) title = h[1];
  } catch { /* no notes yet */ }
  return { slug, title, files, draft, log, templateCaptions: template, canRegenerate: hasSource(slug), hasPrevious: hasPrevious(slug) };
}

export function saveDraft(slug: string, draft: Draft) {
  const dir = kitDir(slug)!;
  fs.writeFileSync(draftPath(dir, slug), JSON.stringify(draft, null, 2) + "\n");
}

export interface KitSummary {
  slug: string;
  title: string;
  cover: string | null;
  posted: PostGroup[];
  updated: number;
}

export function listKits(): KitSummary[] {
  let dirs: fs.Dirent[] = [];
  try { dirs = fs.readdirSync(instaDir(), { withFileTypes: true }); } catch { return []; }
  return dirs
    .filter((d) => d.isDirectory() && SLUG.test(d.name))
    .map((d) => {
      const files = kitFiles(d.name);
      let updated = 0;
      try { updated = fs.statSync(path.join(instaDir(), d.name)).mtimeMs; } catch { /* gone */ }
      const kit = files.main.length ? readKit(d.name) : null;
      return { slug: d.name, title: kit?.title ?? d.name, cover: files.main[0] ?? null, posted: postedGroups(readLog(d.name)), updated };
    })
    .sort((a, b) => b.updated - a.updated);
}

// ---------------------------------------------------------------- the owner's original photos, and earlier studio versions

const sourceDir = (slug: string) => path.join(kitDir(slug)!, ".source");
const previousDir = (slug: string) => path.join(kitDir(slug)!, ".previous");
const sourcePhotos = (slug: string): string[] => {
  try { return fs.readdirSync(sourceDir(slug)).filter((f) => /^photo-\d+\.jpg$/.test(f)).sort(); } catch { return []; }
};
/** Kits made on the Instagram page keep the uploaded photos, so they can use them as they are or be made again. */
export const hasSource = (slug: string) => Boolean(kitDir(slug)) && sourcePhotos(slug).length > 0;

/**
 * The owner's own photos framed for the post: 4:5 for the feed and 9:16 for the Story, cropped around the busiest part of
 * the photo (no stretching, no padding). Nothing else is changed. The uploads in .source stay as they are.
 */
export async function makeOriginals(slug: string): Promise<void> {
  const dir = kitDir(slug);
  if (!dir) return;
  const sharp = (await import("sharp")).default;
  for (const [i, photo] of sourcePhotos(slug).entries()) {
    for (const [name, w, h] of [[`${slug}_${i + 1}_original_4x5_1080x1350.jpg`, 1080, 1350], [`${slug}_${i + 1}_original_story_9x16_1080x1920.jpg`, 1080, 1920]] as const) {
      const out = path.join(dir, name);
      if (fs.existsSync(out)) continue;
      await sharp(fs.readFileSync(path.join(sourceDir(slug), photo))).rotate().resize(w, h, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 92 }).toFile(out);
    }
  }
}

const studioFiles = (slug: string) => {
  const f = kitFiles(slug);
  return [...f.main, ...f.closeup, ...f.square, ...f.story, ...f.claude, ...f.claudeCloseup, ...f.claudeStory];
};
export const hasPrevious = (slug: string) => {
  try { return fs.readdirSync(previousDir(slug)).some((f) => f.endsWith(".jpg")); } catch { return false; }
};

/** Keeps the current studio images before they are made again, so the owner can go back. */
export function snapshotStudio(slug: string) {
  const dir = kitDir(slug)!;
  fs.rmSync(previousDir(slug), { recursive: true, force: true });
  fs.mkdirSync(previousDir(slug), { recursive: true });
  for (const f of studioFiles(slug)) fs.copyFileSync(path.join(dir, f), path.join(previousDir(slug), f));
}

/** Swaps the current studio images with the kept ones, so pressing it again goes forward again. */
export function swapPrevious(slug: string): boolean {
  if (!hasPrevious(slug)) return false;
  const dir = kitDir(slug)!, prev = previousDir(slug), tmp = path.join(dir, ".swap");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  for (const f of fs.readdirSync(prev)) {
    if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(tmp, f));
    fs.renameSync(path.join(prev, f), path.join(dir, f));
  }
  for (const f of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, f), path.join(prev, f));
  fs.rmSync(tmp, { recursive: true, force: true });
  return true;
}
