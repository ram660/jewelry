import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { kitDir, kitFiles, reelName } from "./kits";

/**
 * The last few Reels "Create Reel" made for a kit (instagram/<slug>/<slug>_reelv_<n>_9x16.mp4), which style and track
 * each used, and which one is chosen. The chosen one is copied to the kit's Reel file, which is what Post uses.
 * Server-only.
 */

export const KEEP_REELS = 3;

const Item = z.object({
  file: z.string(),
  // Any id: a style renamed later must not hide the Reels already made (recipeLabel copes with unknown ids).
  recipe: z.string().max(40),
  track: z.string().nullable(),
  at: z.string(),
});
const State = z.object({ items: z.array(Item).default([]), chosen: z.string().nullable().default(null) });
export type ReelItem = z.infer<typeof Item>;
export type ReelState = z.infer<typeof State>;

const statePath = (slug: string) => path.join(kitDir(slug)!, `${slug}_reels.json`);

/** The kept Reels (only files still on disk), newest last. */
export function readReels(slug: string): ReelState {
  if (!kitDir(slug)) return { items: [], chosen: null };
  let s: ReelState = { items: [], chosen: null };
  try { s = State.parse(JSON.parse(fs.readFileSync(statePath(slug), "utf8"))); } catch { /* none yet */ }
  const have = new Set(kitFiles(slug).reels);
  const items = s.items.filter((i) => have.has(i.file));
  return { items, chosen: items.some((i) => i.file === s.chosen) ? s.chosen : null };
}

const write = (slug: string, s: ReelState) => fs.writeFileSync(statePath(slug), JSON.stringify(s, null, 2) + "\n");

/** A new file name for the next Reel. */
export function nextReelFile(slug: string): string {
  const used = kitFiles(slug).reels.map((f) => Number(f.match(/_reelv_(\d+)_/)?.[1] ?? 0));
  return `${slug}_reelv_${Math.max(0, ...used) + 1}_9x16.mp4`;
}

/** Copies a kept Reel to the kit's Reel file and marks it chosen. False if it isn't one of the kept ones. */
export function chooseReel(slug: string, file: string): boolean {
  const s = readReels(slug);
  if (!s.items.some((i) => i.file === file)) return false;
  const dir = kitDir(slug)!;
  fs.copyFileSync(path.join(dir, file), path.join(dir, reelName(slug)));
  write(slug, { ...s, chosen: file });
  return true;
}

/** Records a new Reel, makes it the chosen one, and deletes the oldest beyond the last three. */
export function addReel(slug: string, item: ReelItem): ReelState {
  const s = readReels(slug);
  const items = [...s.items, item];
  const old = items.splice(0, Math.max(0, items.length - KEEP_REELS));
  write(slug, { items, chosen: s.chosen });
  chooseReel(slug, item.file);
  const dir = kitDir(slug)!;
  for (const o of old) fs.rmSync(path.join(dir, o.file), { force: true });
  return readReels(slug);
}
