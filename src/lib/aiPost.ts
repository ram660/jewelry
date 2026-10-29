import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { CATEGORIES, type Category } from "./types";
import { visionProvider } from "./config";
import { askVision } from "./providers/vision";
import { parseJsonLoose } from "./json";
import { postProblems } from "./postNotes";
import { kitDir, kitFiles, templateDraft, type KitMeta } from "./kits";
import { Draft, type KitFiles } from "./kitDraft";

/**
 * The AI writes the Instagram post for a kit: one caption, hashtags and alt text, from the kit's own photos. It uses the
 * Studio's vision provider (an API key in Settings; see lib/config.ts). Everything it returns is checked here: no price,
 * length or order details it could have invented, no gold-plated wording on a silver-tone piece, no banned claims.
 * If no provider is set up, or it fails, simple template captions are used and the page says so. Server-only.
 */

/** The shop's own call to action, as used in its posts. The price is always a blank the owner fills in. */
export const CTA = "Comment ✨ and we'll DM you the details.";
const CORE_TAGS = ["#ElegantFashionJewellery", "#vancouverjewellery", "#shopsmallyvr", "#yvrstyle"];

const Reply = z.object({
  category: z.enum(CATEGORIES).catch("other"),
  tone: z.enum(["gold", "silver"]).catch("gold"),
  caption: z.string().catch(""),
  hashtags: z.array(z.string()).catch([]),
  alt_main: z.string().catch(""),
  alt_closeup: z.string().catch(""),
  /** Any brand name, logo or engraved word on the piece. Only its presence is kept, never the text. */
  marks_seen: z.array(z.string()).catch([]),
});

function loadBrand(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "docs", "BRAND.md"), "utf8");
  } catch {
    return "Warm, polished, helpful. Canadian spelling. Prices in CAD.";
  }
}

export interface WriteFacts {
  name: string;
  /** What the owner set on the review page, if anything. Otherwise the AI decides from the photos. */
  category?: Category;
  tone?: "gold" | "silver";
}

export function buildPostPrompt(f: WriteFacts, brand: string): string {
  return `You write Instagram posts for Elegant Fashion Jewellery, a Vancouver, BC shop selling 10K gold-plated fashion jewellery.
The photos show ONE product on a studio background (the first is the main photo, the second a close-up). Write its Instagram post.

BRAND GUIDE (follow it):
${brand}

KNOWN FACTS
- Product name: ${f.name}
${f.category ? `- Type (owner set): ${f.category}\n` : ""}${f.tone ? `- Tone (owner set): ${f.tone === "gold" ? "gold-tone" : "silver-tone"}\n` : ""}
RULES
- Describe only what you can see: shape, colours, stones you can clearly see, how to wear or layer it, an occasion.
- Gold-tone pieces are "10K gold-plated". Never write "10K gold" without "plated", "solid/real/pure/genuine gold", any other karat, "waterproof", "tarnish-free", "hypoallergenic", "nickel-free", "lasts forever" or how long it lasts.
- Silver-tone pieces: say "silver-tone". Do NOT say gold-plated, sterling, silver-plated or any metal.
- Never write a price, size, length, weight, base metal, stock, shipping or delivery detail. The caption's last line must be exactly: "$[PRICE] CAD. ${CTA}"
- Never write a brand, designer or collection name, "dupe", "inspired by", "replica", "look for less", "designer" or "luxury".
- Canadian spelling (jewellery, colour, favourite). At most 2 emojis, only from ✨ 💛 🤍 🎁 📦 🌿.
- Caption shape: a one-line hook; a blank line; 1-2 short sentences on the piece; a blank line; the price line. No hashtags in the caption.
- Hashtags: 15, each starting with #, starting with ${CORE_TAGS.join(" ")}, then product, style and occasion tags. Any tag about gold must say plated (e.g. #goldplatedjewellery), never a bare #gold tag.
- Alt text: one plain sentence per photo saying what it shows (piece, colours, background).
- marks_seen: every brand name, logo, monogram or engraved word you can read ON THE PIECE ITSELF. Empty list if none.

Reply with ONLY this JSON:
{"category": one of ${JSON.stringify(CATEGORIES)}, "tone": "gold" | "silver", "caption": "...", "hashtags": ["#..."], "alt_main": "...", "alt_closeup": "...", "marks_seen": []}`;
}

const CANADIAN: [RegExp, string][] = [
  // center → centre, centres; centered → centred; centering → centring
  [/\bcenter(s)?\b/gi, "centre$1"], [/\bcentered\b/gi, "centred"], [/\bcentering\b/gi, "centring"],
  [/\bjewelry\b/gi, "jewellery"], [/\bcolor(s|ful|ed)?\b/gi, "colour$1"],
  [/\bfavorite(s)?\b/gi, "favourite$1"], [/\bgray\b/gi, "grey"],
];
/** Canadian spelling for the usual US slips (the brand guide asks for it), keeping a leading capital. */
export function canadian(text: string): string {
  return CANADIAN.reduce(
    (t, [re, to]) =>
      t.replace(re, (m: string, g?: unknown) => {
        const out = to.replace("$1", typeof g === "string" ? g : "");
        return m[0] === m[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
      }),
    text
  );
}

/** Checks one AI reply and turns it into post text. Throws with the reason when it can't be used. */
export function checkReply(raw: unknown, f: WriteFacts): { category: Category; tone: "gold" | "silver"; caption: string; hashtags: string; altMain: string; altCloseup: string; marked: boolean } {
  const r = Reply.parse(raw);
  const tone = f.tone ?? r.tone;
  const category = f.category ?? r.category;
  let caption = canadian(r.caption.trim().replace(/\r\n/g, "\n"));
  if (!caption) throw new Error("the AI wrote no caption");
  // Any price the AI wrote becomes the blank the owner fills in.
  caption = caption.replace(/\$\s?\d[\d,.]*(\s*CAD)?/gi, "$[PRICE] CAD").replace(/\$\[PRICE\] CAD CAD/g, "$[PRICE] CAD");
  if (!/\$\[PRICE\]/.test(caption)) caption = `${caption}\n\n$[PRICE] CAD. ${CTA}`;
  const tags = [...new Set([...CORE_TAGS, ...r.hashtags.map((t) => "#" + t.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length > 2)])].slice(0, 20);
  const hashtags = tags.join(" ");
  const alts = [canadian(r.alt_main.trim()), canadian(r.alt_closeup.trim())];
  const all = [caption, hashtags, ...alts].join("\n");
  if (tone === "silver" && /gold[- ]?plated/i.test(all)) throw new Error("the AI called a silver-tone piece gold-plated");
  if (/\b\d+(\.\d+)?\s?(?:inch(?:es)?|in\b|cm|mm|")/i.test(all)) throw new Error("the AI wrote a size or length");
  // Banned wording (the [PRICE] blank is expected and filled in by the owner).
  const banned = postProblems(`${caption}\n\n${hashtags}`, alts.filter(Boolean)).filter((p) => !/^Fill in or remove: \[PRICE\]$/.test(p));
  if (banned.length) throw new Error(`the AI's text broke the wording rules (${banned.join("; ")})`);
  return { category, tone, caption, hashtags, altMain: alts[0], altCloseup: alts[1], marked: r.marks_seen.some((m) => m.trim()) };
}

async function photosFor(slug: string, files: KitFiles): Promise<Buffer[]> {
  const dir = kitDir(slug)!;
  const picks = [files.main[0], files.closeup[0]].filter((f): f is string => Boolean(f));
  // Read into memory first: on Windows, sharp keeps a file it opened by path locked, and the kit couldn't be made again.
  return Promise.all(picks.map((f) => sharp(fs.readFileSync(path.join(dir, f))).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 85 }).toBuffer()));
}

export type Ask = (prompt: string, jpegs: Buffer[]) => Promise<string>;

/**
 * Writes (or rewrites) the post text into the given draft. Keeps everything the owner set: slides, price, order, length,
 * what to post. Two tries; then the simple templates, with the reason in aiNote.
 */
export async function writePost(
  slug: string,
  base: Draft,
  f: WriteFacts,
  opts: { ask?: Ask; provider?: string | null; files?: KitFiles } = {}
): Promise<Draft> {
  const files = opts.files ?? kitFiles(slug);
  const provider = opts.provider !== undefined ? opts.provider : visionProvider();
  const ask: Ask = opts.ask ?? ((p, j) => askVision(p, j, { temperature: 0.8 }));
  const fallback = (why: string) => {
    const meta: KitMeta = { name: f.name, category: f.category ?? base.category, finish: f.tone ?? base.tone, price: base.fields.price };
    const t = templateDraft(meta, files);
    return Draft.parse({ ...base, captions: t.captions, caption: t.caption, hashtags: t.hashtags, alts: { ...t.alts, ...base.alts }, aiNote: why });
  };
  if (!provider) return fallback("AI isn't set up (no vision key in Settings), so these are simple template captions.");
  let lastError = "";
  try {
    const jpegs = await photosFor(slug, files);
    const prompt = buildPostPrompt(f, loadBrand());
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = checkReply(parseJsonLoose(await ask(prompt, jpegs)), f);
        const alts = { ...base.alts };
        if (files.main[0] && out.altMain) alts[files.main[0]] = out.altMain;
        if (files.closeup[0] && out.altCloseup) alts[files.closeup[0]] = out.altCloseup;
        return Draft.parse({
          ...base,
          captions: [out.caption],
          caption: out.caption,
          hashtags: out.hashtags,
          alts,
          category: out.category,
          tone: out.tone,
          marked: out.marked,
          aiNote: `Written by AI (${provider}). Check it before posting.`,
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  return fallback(`The AI couldn't write this one (${lastError.slice(0, 160)}), so these are simple template captions. Try Rewrite.`);
}
