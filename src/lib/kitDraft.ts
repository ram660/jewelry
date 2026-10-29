import { z } from "zod";
import { fullCaption, postProblems, type PostNotes } from "./postNotes";
import { CATEGORIES } from "./types";

/**
 * What the Instagram page is about to post for one kit (a folder under instagram/), and the checks that decide whether
 * Post is allowed. Pure, so the page and the server run exactly the same checks.
 */

export type PostKind = "image" | "carousel" | "story" | "reel";
/** Photo posts, Stories and Reels are logged separately: one of each per kit unless the owner asks for it again. */
export type PostGroup = "feed" | "story" | "reel";
export const postGroup = (k: string): PostGroup => (k === "story" ? "story" : k === "reel" ? "reel" : "feed");

export interface LogEntry {
  at: string;
  kind: PostKind;
  files: string[];
  status: "published" | "check-instagram";
  mediaId?: string;
  permalink?: string;
}

/** The kit's images, sorted by what they are for. File names only. */
export interface KitFiles {
  main: string[];
  closeup: string[];
  square: string[];
  story: string[];
  reel: string | null;
  /** The owner's own photos, framed for the post without any other change (made from the upload). */
  original: string[];
  originalStory: string[];
  /** The same cut-out piece laid out as Claude suggested (placement only; see lib/claudeStyle.ts). */
  claude: string[];
  claudeCloseup: string[];
  claudeStory: string[];
  /** AI scenes Gemini made on the owner's request (see lib/aiScene.ts). Never selected by default. */
  ai: string[];
  /** The last few Reels "Create Reel" made; the chosen one is copied to `reel`. */
  reels: string[];
}

export function sortKitFiles(names: string[]): KitFiles {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const pick = (re: RegExp) => sorted.filter((f) => re.test(f));
  return {
    main: pick(/_\d+_4x5_1080x1350\.jpe?g$/i),
    closeup: pick(/_\d+_closeup_4x5_1080x1350\.jpe?g$/i),
    square: pick(/_\d+_1x1_1080x1080\.jpe?g$/i),
    story: pick(/_\d+_story_9x16_1080x1920\.jpe?g$/i),
    reel: sorted.find((f) => /_reel_9x16\.mp4$/i.test(f)) ?? null,
    original: pick(/_\d+_original_4x5_1080x1350\.jpe?g$/i),
    originalStory: pick(/_\d+_original_story_9x16_1080x1920\.jpe?g$/i),
    claude: pick(/_\d+_claude_4x5_1080x1350\.jpe?g$/i),
    claudeCloseup: pick(/_\d+_claude_closeup_4x5_1080x1350\.jpe?g$/i),
    claudeStory: pick(/_\d+_claude_story_9x16_1080x1920\.jpe?g$/i),
    ai: pick(/_\d+_ai_4x5_1080x1350\.jpe?g$/i),
    reels: pick(/_reelv_\d+_9x16\.mp4$/i),
  };
}

export const MAX_SLIDES = 10;

export const Fields = z.object({
  price: z.string().max(20).default(""),
  order: z.string().max(200).default(""),
  length: z.string().max(60).default(""),
});

export const Draft = z.object({
  /** The caption choices the owner picks from (from the post notes, or simple templates for a new kit). */
  captions: z.array(z.string().max(2200)).max(10).default([]),
  caption: z.string().max(2200).default(""),
  hashtags: z.string().max(1000).default(""),
  /** Feed slides in order (4:5 file names). One slide is a single photo post, two or more a carousel. */
  slides: z.array(z.string().max(120)).max(MAX_SLIDES).default([]),
  /** Alt text per slide file name. */
  alts: z.record(z.string().max(120), z.string().max(1000)).default({}),
  feed: z.boolean().default(true),
  story: z.boolean().default(true),
  reel: z.boolean().default(false),
  /** Audio file name from the tracks folder, for the Reel. */
  track: z.string().max(200).default(""),
  /** "Create Reel" makes the Reel without music. */
  mute: z.boolean().default(false),
  fields: Fields.default({ price: "", order: "", length: "" }),
  /** What the piece is and its colour, as the AI saw it; the owner can correct both on the review page. */
  category: z.enum(CATEGORIES).catch("other").default("other"),
  tone: z.enum(["gold", "silver"]).catch("gold").default("gold"),
  /** The AI saw a mark on the piece itself. Such a piece is skipped: never posted, and the mark is never written down. */
  marked: z.boolean().default(false),
  /** Who wrote the text (AI or the simple templates), shown above the caption. */
  aiNote: z.string().max(400).default(""),
  /** "studio": the cut-out piece on a studio backdrop. "claude": the same, laid out as Claude suggested. "original": the
   *  owner's own photos. "ai": AI scenes the owner asked Gemini for (the Story stays the studio one). Picks the Story image too. */
  look: z.enum(["studio", "claude", "original", "ai"]).catch("studio").default("studio"),
});
export type Draft = z.infer<typeof Draft>;

/** Fills [PRICE], [ORDER CTA] and [CHAIN LENGTH] blanks from the page's fields. Empty fields leave the blank in place. */
export function applyFields(text: string, f: Draft["fields"]): string {
  const price = f.price.trim().replace(/^\$/, "").replace(/\s*CAD$/i, "");
  let out = text;
  if (price) out = out.replace(/\[PRICE\]/gi, price);
  if (f.order.trim()) out = out.replace(/\[(?:ORDER CTA|HOW TO ORDER)\]/gi, f.order.trim());
  if (f.length.trim()) out = out.replace(/\[(?:CHAIN LENGTH|LENGTH)\]/gi, f.length.trim());
  return out;
}

/** The caption exactly as it goes to Instagram. */
export const finalCaption = (d: Draft) => fullCaption(applyFields(d.caption.trim(), d.fields), applyFields(d.hashtags.trim(), d.fields));
export const finalAlts = (d: Draft) => d.slides.map((s) => applyFields(d.alts[s] ?? "", d.fields).trim());

export interface PostPlanItem {
  kind: PostKind;
  files: string[];
}

/** The Story image for the chosen look (the studio one when there is no original). */
export const storyFile = (d: Draft, files: KitFiles): string | null =>
  (d.look === "original" ? files.originalStory[0] : d.look === "claude" ? files.claudeStory[0] : undefined) ?? files.story[0] ?? null;

/** Every image that can be a feed slide. */
export const slideFiles = (files: KitFiles): string[] =>
  [...files.main, ...files.closeup, ...files.square, ...files.original, ...files.claude, ...files.claudeCloseup, ...files.ai];

/** Slides for a look: the studio main photo and close-up, or the owner's own photos. AI scenes in `notRecommended`
 *  (a low match score) are left out; the owner can still add one by hand. */
export const slidesFor = (look: Draft["look"], files: KitFiles, notRecommended: string[] = []): string[] =>
  look === "ai" && files.ai.some((f) => !notRecommended.includes(f))
    ? files.ai.filter((f) => !notRecommended.includes(f)).slice(0, MAX_SLIDES)
    : look === "original" && files.original.length
    ? files.original.slice(0, MAX_SLIDES)
    : look === "claude" && files.claude.length
      ? [files.claude[0], files.claudeCloseup[0]].filter((f): f is string => Boolean(f))
      : [files.main[0], files.closeup[0]].filter((f): f is string => Boolean(f));

/** The posts Post would make, in order: the photo post (single or carousel), the Reel, then the Story. */
export function planPosts(d: Draft, files: KitFiles): PostPlanItem[] {
  const plan: PostPlanItem[] = [];
  if (d.feed && d.slides.length) plan.push({ kind: d.slides.length > 1 ? "carousel" : "image", files: d.slides });
  if (d.reel && files.reel) plan.push({ kind: "reel", files: [files.reel] });
  const story = storyFile(d, files);
  if (d.story && story) plan.push({ kind: "story", files: [story] });
  return plan;
}

/** Everything that stops Post. Empty means it can go. */
export function draftProblems(d: Draft, files: KitFiles, posted: PostGroup[] = []): string[] {
  const problems: string[] = [];
  if (d.marked) return ["Skipped: this piece can't be posted from here."];
  const plan = planPosts(d, files);
  if (!plan.length) problems.push("Nothing is selected to post.");
  if (d.feed && !d.slides.length) problems.push("Pick at least one photo for the post, or untick the photo post.");
  const known = new Set(slideFiles(files));
  for (const s of d.slides) if (!known.has(s)) problems.push(`${s} is not one of this kit's photos.`);
  if (d.reel && !files.reel) problems.push("Build the Reel first, or untick it.");
  if (d.story && !storyFile(d, files)) problems.push("This kit has no Story image.");
  for (const p of plan) {
    const g = postGroup(p.kind);
    if (posted.includes(g)) problems.push(`This kit's ${g === "feed" ? "photo post" : g === "reel" ? "Reel" : "Story"} is already on Instagram (or waiting to be checked). Untick it.`);
  }
  const needsCaption = plan.some((p) => p.kind !== "story");
  if (needsCaption) {
    if (!d.caption.trim()) problems.push("Write or pick a caption.");
    problems.push(...postProblems(finalCaption(d), d.feed ? finalAlts(d).filter(Boolean) : []));
    if (d.tone === "silver" && /gold[- ]?plated/i.test([finalCaption(d), ...finalAlts(d)].join("\n"))) {
      problems.push("This is a silver-tone piece: take out \"gold-plated\", or press Rewrite.");
    }
  }
  return [...new Set(problems)];
}

/** A first draft from the kit's post notes: the first caption, its hashtags, and the main photo then the close-up. */
export function draftFromNotes(notes: PostNotes, files: KitFiles): Draft {
  const slides = [files.main[0], files.closeup[0]].filter((f): f is string => Boolean(f));
  const alts: Record<string, string> = {};
  if (files.main[0] && notes.alt.slide1) alts[files.main[0]] = notes.alt.slide1;
  if (files.closeup[0] && notes.alt.slide2) alts[files.closeup[0]] = notes.alt.slide2;
  return Draft.parse({ captions: notes.captions, caption: notes.captions[0] ?? "", hashtags: notes.hashtags, slides, alts });
}
