import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { claudeConfigured } from "./config";
import { claudeJson } from "./providers/claude";
import { parseJsonLoose } from "./json";
import { kitDir, kitFiles } from "./kits";

/**
 * Claude as art director for a second version of the studio images. It looks at the owner's photo and the BiRefNet cutout
 * on its backdrop and picks a backdrop, layout, zoom, shadow and close-up point from fixed lists, or flags the photo. It never
 * makes or edits a picture: the second version is rendered by scripts/instagram-kit.mts from the same cut-out pixels.
 * Claude's own words are never shown or stored (they could name a brand); flags map to fixed, generic reasons. Server-only.
 */

const FLAGS = {
  cutout: "the cutout isn't clean",
  distortion: "the piece looks distorted",
  "missing-parts": "part of the piece is missing",
  mark: "a mark is stamped on the piece",
  "backdrop-text": "there is text left on the background",
  "low-quality": "the photo quality is too low",
} as const;
type Flag = keyof typeof FLAGS;

/** Claude's backdrop words, as the kit script's template ids. */
export const BACKDROP_TEMPLATE = { cream: "ivory", "warm-grey": "stone", charcoal: "noir", blush: "blush-arch" } as const;

const Reply = z.object({
  verdict: z.enum(["ok", "flag"]),
  flags: z.array(z.string()).catch([]),
  style: z
    .object({
      backdrop: z.enum(["cream", "warm-grey", "charcoal", "blush"]).catch("cream"),
      layout: z.enum(["centred", "slightly-low", "diagonal"]).catch("centred"),
      zoom: z.number().catch(1),
      closeup_focus: z.object({ x: z.number(), y: z.number() }).nullable().catch(null),
      shadow: z.enum(["soft", "light"]).catch("soft"),
    })
    .nullable()
    .catch(null),
  tone: z.enum(["gold-tone", "silver-tone"]).catch("gold-tone"),
});

export interface Style {
  template: (typeof BACKDROP_TEMPLATE)[keyof typeof BACKDROP_TEMPLATE];
  layout: "centred" | "slightly-low" | "diagonal";
  zoom: number;
  shadow: "soft" | "light";
  focus: { x: number; y: number } | null;
}

/** What the page shows about the Claude version. */
export type StyleResult =
  | { status: "ok"; style: Style; at: string }
  | { status: "skipped"; reason: string; mark: boolean; at: string }
  | { status: "unavailable"; reason: string; at: string };

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function buildStylePrompt(avoid: string | null): string {
  return `You are the art director for Elegant Fashion Jewellery's Instagram. Photo 1 is the owner's photo of ONE piece. Photo 2 is the piece cut out by software and placed on a studio backdrop.
You choose how the cut-out piece is laid out in a second version. You never change the jewellery: no recolouring, reshaping, retouching or adding anything. Software does the layout from your choices.

First check the cutout and the photo. Use verdict "flag" (and give no style) if ANY of these is true, listing the codes that apply:
- "cutout": the cutout is not clean (bits of background, display stand or velvet left, rough edges)
- "distortion": the piece looks stretched, squashed or warped
- "missing-parts": part of the piece (chain, clasp, stone, earring) is cut off or missing
- "mark": a logo, brand name, monogram or engraved word is stamped on the piece itself
- "backdrop-text": text, a logo or a mark is still visible on the background
- "low-quality": the photo is too blurry, dark or small to look good

If none apply, verdict "ok" and choose:
- backdrop: "cream" | "warm-grey" | "charcoal" | "blush" (cream or blush suit gold-tone, warm-grey suits silver-tone, charcoal suits both)
- layout: "centred" | "slightly-low" | "diagonal"
- zoom: 0.7 to 1.0 (1.0 fills the frame)
- closeup_focus: {"x": 0-1, "y": 0-1}, the most detailed part of the cut-out piece in photo 2 (x from left, y from top of the piece)
- shadow: "soft" | "light"
${avoid ? `Choose something different from the last version (${avoid}).\n` : ""}
Reply with ONLY this JSON, no other words:
{"verdict": "ok" | "flag", "flags": [codes], "style": {"backdrop": "...", "layout": "...", "zoom": 0.9, "closeup_focus": {"x": 0.5, "y": 0.5}, "shadow": "..."} or null, "tone": "gold-tone" | "silver-tone"}`;
}

/** Turns Claude's reply into a result. Anything that isn't exactly the agreed shape counts as unusable. */
export function readStyleReply(raw: unknown): StyleResult {
  const at = new Date().toISOString();
  const r = Reply.parse(raw);
  const flags = r.flags.filter((f): f is Flag => f in FLAGS);
  if (r.verdict === "flag" || !r.style) {
    const mark = flags.includes("mark");
    // A stamped mark is never described, only "skipped", like everywhere else.
    const reason = mark ? "skipped" : flags.length ? flags.map((f) => FLAGS[f]).join("; ") : "the photo isn't suitable";
    return { status: "skipped", reason, mark, at };
  }
  const s = r.style;
  return {
    status: "ok",
    at,
    style: {
      template: BACKDROP_TEMPLATE[s.backdrop],
      layout: s.layout,
      zoom: Math.round(clamp(s.zoom, 0.7, 1) * 100) / 100,
      shadow: s.shadow,
      focus: s.closeup_focus ? { x: clamp(s.closeup_focus.x, 0, 1), y: clamp(s.closeup_focus.y, 0, 1) } : null,
    },
  };
}

const statePath = (slug: string) => path.join(kitDir(slug)!, ".claude-style.json");
export function readStyleState(slug: string): StyleResult | null {
  try { return JSON.parse(fs.readFileSync(statePath(slug), "utf8")) as StyleResult; } catch { return null; }
}
const saveState = (slug: string, r: StyleResult) => fs.writeFileSync(statePath(slug), JSON.stringify(r, null, 2) + "\n");

export type AskClaude = (prompt: string, jpegs: Buffer[]) => Promise<string>;

/** Asks Claude for a layout. Never throws: problems become "unavailable" with a plain reason (the key is never in it). */
export async function askForStyle(slug: string, opts: { ask?: AskClaude; configured?: boolean } = {}): Promise<StyleResult> {
  const at = new Date().toISOString();
  const configured = opts.configured ?? claudeConfigured();
  if (!configured) {
    const r: StyleResult = { status: "unavailable", reason: "Claude styling unavailable: no Claude API key in the Studio settings.", at };
    saveState(slug, r);
    return r;
  }
  const dir = kitDir(slug)!;
  const files = kitFiles(slug);
  const source = path.join(dir, ".source", "photo-01.jpg");
  if (!files.main[0] || !fs.existsSync(source)) {
    const r: StyleResult = { status: "unavailable", reason: "Claude styling unavailable for this kit (no uploaded photo).", at };
    saveState(slug, r);
    return r;
  }
  const previous = readStyleState(slug);
  const avoid = previous?.status === "ok" ? `${previous.style.template}, ${previous.style.layout}` : null;
  // Read into memory first (on Windows sharp would keep the files locked), and send small copies.
  const small = (f: string) => sharp(fs.readFileSync(f)).rotate().resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  let result: StyleResult = { status: "unavailable", reason: "Claude styling unavailable.", at };
  let text: string | null = null;
  try {
    const jpegs = [await small(source), await small(path.join(dir, files.main[0]))];
    const ask = opts.ask ?? ((p: string, j: Buffer[]) => claudeJson(p, j, { effort: "low" }));
    text = await ask(buildStylePrompt(avoid), jpegs);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/sk-ant-[\w-]+/g, "[key]").slice(0, 200);
    result = { status: "unavailable", reason: `Claude styling unavailable: ${msg}`, at };
  }
  if (text !== null) {
    try {
      result = readStyleReply(parseJsonLoose(text));
    } catch {
      // Never echo the reply itself: it is Claude's free text.
      result = { status: "unavailable", reason: "Claude styling unavailable: its answer wasn't in the agreed form. Try again.", at };
    }
  }
  saveState(slug, result);
  return result;
}
