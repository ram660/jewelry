import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { geminiConfigured, geminiImageModel } from "./config";
import { kitDir, kitFiles } from "./kits";
import type { FidelityResult } from "./visuals";

/**
 * AI scenes for an Instagram kit: Gemini redraws the piece in a styled scene, from the kit's own cut-out. Only ever started
 * by the owner pressing the button on the review page, never on upload or page load. Every result is checked by the
 * Studio's own fidelity check (lib/visuals.ts): a picture with any text or logo in it, or one the check couldn't score, is
 * thrown away. A low match score is kept but flagged. Generated pictures are an extra choice; nothing selects them by
 * itself. Server-only.
 */

export const AI_STYLES = {
  "soft-studio": "on a soft, seamless cream studio backdrop with gentle diffused light and a faint natural shadow",
  marble: "resting on a polished white marble surface with soft grey veining, in soft window light",
  silk: "resting on softly draped champagne-coloured silk with gentle folds, in soft warm light",
  daylight: "on a pale wooden tabletop beside a bright window, in soft natural daylight with a gentle shadow and a blurred background",
} as const;
export type AiStyle = keyof typeof AI_STYLES;
export const AI_STYLE_IDS = Object.keys(AI_STYLES) as [AiStyle, ...AiStyle[]];

/** Match scores under this are flagged in red (the same setting as the product studio's AI pictures). */
export const fidelityMin = () => Number(process.env.FIDELITY_MIN) || 75;

export function aiScenePrompt(style: AiStyle): string {
  return `Create a premium Instagram product photograph of the EXACT piece of jewellery shown in the reference photo(s), ${AI_STYLES[style]}.
CRITICAL: keep the jewellery exactly as it is in the photos: the same shape and proportions, the same number, size, colour and placement of every stone and detail, the same metal tones in the same places (gold, rose-gold or silver-tone areas stay exactly where they are), the same finish. Do not add, remove, simplify, repair or redesign any part of it. Keep it in sharp focus and clearly the hero of the image.
No text, letters, numbers, logos, brand marks, monograms, watermarks or signatures anywhere in the image, and no props with writing on them. No hands, no people, no other jewellery.
Photorealistic, soft natural light, elegant and uncluttered, portrait 4:5.`;
}

export interface AiSceneMeta {
  file: string;
  style: AiStyle;
  score: number;
  /** Below the match threshold: shown in red and not recommended. */
  low: boolean;
  notes: string;
  model: string;
  at: string;
}

export const AiSceneState = z.array(
  z.object({
    file: z.string(),
    style: z.enum(AI_STYLE_IDS),
    score: z.number(),
    low: z.boolean(),
    notes: z.string(),
    model: z.string(),
    at: z.string(),
  })
);

const statePath = (slug: string) => path.join(kitDir(slug)!, `${slug}_ai.json`);
/** The AI scenes kept for a kit, with their match scores. Only files that are still there. */
export function readAiScenes(slug: string): AiSceneMeta[] {
  if (!kitDir(slug)) return [];
  try {
    const all = AiSceneState.parse(JSON.parse(fs.readFileSync(statePath(slug), "utf8")));
    const have = new Set(kitFiles(slug).ai);
    return all.filter((m) => have.has(m.file));
  } catch {
    return [];
  }
}

export type Generate = (prompt: string, jpegs: Buffer[]) => Promise<Buffer>;
export type Check = (originals: Buffer[], generated: Buffer) => Promise<FidelityResult>;

/**
 * The reference photos for the model and the check: the kit's cached cut-outs (the piece alone on white, so no studio logo
 * or background writing can leak into the picture), or the owner's framed originals when there is no cut-out.
 */
async function references(slug: string): Promise<Buffer[]> {
  const dir = kitDir(slug)!;
  const out: Buffer[] = [];
  try {
    for (const f of fs.readdirSync(path.join(dir, ".cutouts")).filter((n) => n.endsWith(".json")).sort().slice(0, 2)) {
      const c = JSON.parse(fs.readFileSync(path.join(dir, ".cutouts", f), "utf8")) as { png?: string };
      if (!c.png) continue;
      out.push(await sharp(Buffer.from(c.png, "base64")).flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 90 }).toBuffer());
    }
  } catch { /* no cut-outs cached */ }
  if (out.length) return out;
  for (const f of kitFiles(slug).original.slice(0, 2)) {
    out.push(await sharp(fs.readFileSync(path.join(dir, f))).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 90 }).toBuffer());
  }
  return out;
}

const nextIndex = (slug: string) => {
  const used = kitFiles(slug).ai.map((f) => Number(f.match(/_(\d+)_ai_/)?.[1] ?? 0));
  return Math.max(0, ...used) + 1;
};

export interface AiSceneOutcome {
  kept: AiSceneMeta[];
  /** Why each discarded picture was dropped. Never the text or logo itself. */
  dropped: string[];
}

/**
 * Makes `count` (1 or 2) AI scenes in the chosen style. Each is checked before it is kept. The page's draft is not touched,
 * so whatever the owner had selected stays selected.
 */
export async function generateAiScenes(
  slug: string,
  opts: { count: 1 | 2; style: AiStyle },
  log: (line: string) => void,
  deps: { generate?: Generate; check?: Check; configured?: boolean; model?: string } = {}
): Promise<AiSceneOutcome> {
  const dir = kitDir(slug);
  if (!dir) throw new Error("Unknown kit.");
  if (!(deps.configured ?? geminiConfigured())) throw new Error("No Gemini API key is set up, so AI scenes can't be made. Add GEMINI_API_KEY in Settings.");
  const generate: Generate = deps.generate ?? (async (p, j) => (await import("./providers/gemini")).geminiImage(p, j));
  const check: Check = deps.check ?? (async (o, g) => (await import("./visuals")).fidelityCheck(o, g));
  const model = deps.model ?? geminiImageModel();
  const refs = await references(slug);
  if (!refs.length) throw new Error("This kit has no photos to work from.");

  const prompt = aiScenePrompt(opts.style);
  const kept: AiSceneMeta[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const n = `${i + 1} of ${opts.count}`;
    log(`Asking Gemini for AI scene ${n}…`);
    let raw: Buffer;
    try {
      raw = await generate(prompt, refs);
    } catch (e) {
      dropped.push(`Scene ${n}: Gemini couldn't make it (${e instanceof Error ? e.message.slice(0, 160) : String(e)}).`);
      log(dropped[dropped.length - 1]);
      continue;
    }
    let img: Buffer, f: FidelityResult;
    try {
      img = await sharp(raw).resize(1080, 1350, { fit: "cover", position: "centre" }).jpeg({ quality: 92 }).toBuffer();
      log(`Checking scene ${n} against your piece…`);
      f = await check(refs, img);
    } catch (e) {
      dropped.push(`Scene ${n} was thrown away: it couldn't be read or checked (${e instanceof Error ? e.message.slice(0, 120) : String(e)}).`);
      log(dropped[dropped.length - 1]);
      continue;
    }
    if (f.marks) {
      dropped.push(`Scene ${n} was thrown away: it had text or a logo in it.`);
      log(dropped[dropped.length - 1]);
      continue;
    }
    if (f.score === null) {
      dropped.push(`Scene ${n} was thrown away: the match check couldn't run, so it can't be trusted. ${f.notes}`);
      log(dropped[dropped.length - 1]);
      continue;
    }
    const file = `${slug}_${nextIndex(slug)}_ai_4x5_1080x1350.jpg`;
    fs.writeFileSync(path.join(dir, file), img);
    const meta: AiSceneMeta = { file, style: opts.style, score: f.score, low: f.score < fidelityMin(), notes: f.notes, model, at: new Date().toISOString() };
    kept.push(meta);
    fs.writeFileSync(statePath(slug), JSON.stringify([...readAiScenes(slug).filter((m) => m.file !== file), meta], null, 2) + "\n");
    log(`Scene ${n}: ${f.score}% match${meta.low ? " (doesn't match your piece closely: not recommended)" : ""}.`);
  }
  if (!kept.length) throw new Error(dropped.join(" ") || "No AI scene was kept.");
  return { kept, dropped };
}
