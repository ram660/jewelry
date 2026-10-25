import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CATEGORIES, type Product, type ProductImage } from "./types";
import { toModelJpeg, uploadPath } from "./storage";
import { visionProvider } from "./config";
import { askVision } from "./providers/vision";
import { parseJsonLoose } from "./json";
import { templateAltText, templateCaptions, templateDescriptions, templateHashtags } from "./captions";

const strList = z.array(z.string()).catch([]);

const Analysis = z.object({
  category: z.enum(CATEGORIES).catch("other"),
  subcategory: z.string().catch(""),
  gender: z.enum(["women", "men", "unisex"]).catch("women"),
  colour_finish: z.string().catch(""),
  stones: z.string().catch(""),
  name_suggestions: strList,
  style_tags: strList,
  occasion_tags: strList,
  short_desc: z.string().catch(""),
  long_desc: z.string().catch(""),
  care_notes: z.string().catch(""),
  captions: strList,
  hashtags: strList,
  alt_text: z.string().catch(""),
  owner_questions: strList,
  marks_seen: strList,
});
export type AnalysisResult = z.infer<typeof Analysis>;

async function loadBrand(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "BRAND.md"), "utf8");
  } catch {
    return "Warm, polished, helpful. Canadian spelling. Prices in CAD.";
  }
}

/** The exact instructions sent to the vision model. Exported so scripts/bench-models.mts tests models with the real prompt. */
export function buildPrompt(p: Product, brand: string): string {
  const known = [
    `Owner's product name: ${p.name || "(none given)"}`,
    p.base_metal && `Base metal (owner confirmed): ${p.base_metal}`,
    p.sizes && `Sizes (owner confirmed): ${p.sizes}`,
    p.plating && `Plating (owner's note): ${p.plating}`,
    p.price_cad != null && `Price: $${p.price_cad} CAD`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are the product copywriter for Elegant Fashion Jewellery, a Vancouver, BC shop selling 10K gold-plated fashion jewellery.
Look at the photos of ONE jewellery piece and return JSON describing it.

BRAND GUIDE (follow it exactly):
${brand}

KNOWN FACTS:
${known}

HARD RULES
- Plating: if the owner's plating note says 10K gold-plated AND the metal in the photos looks gold, call it "10K gold-plated". If the metal looks silver, white or rose, do NOT call it gold: describe the colour you see and ask the owner what the plating is in "owner_questions". Never write "10K gold" (without "plated"), "solid gold", "real/genuine/pure/authentic gold", any other karat, "waterproof", "water-resistant", "tarnish-free", "fade-proof", "lasts forever", "lifetime", "hypoallergenic", "skin-safe", "nickel-free". Never promise how long it lasts.
- Describe only what is visible in the photos. Do not invent stones, sizes, weight, base metal, plating thickness, nickel-free status, shipping, delivery, returns, gift-box or response-time details.
- Marks on the piece: list every brand name, logo, monogram, hallmark or engraved word you can read on the piece, its stand or a tag in "marks_seen", copied exactly as it appears (keep the spelling and capitals; use an empty list if there are none). Never leave out or change a mark you can see.
- If "marks_seen" is not empty: describe the design neutrally (shape, finish, stones). Do not use another brand's name as a selling point in the name, descriptions, captions or hashtags, do not say the piece is authentic, genuine, original, a replica, a dupe or "inspired by" anyone, and do not guess where it was made. The owner decides that.
- Any price, size, stone or delivery detail inside the BRAND GUIDE example lines is an illustration, never a fact about this piece. Do not copy it.
- Anything a photo cannot show (base metal, size/length, weight, nickel-free, plating thickness) goes in "owner_questions" as short questions for the owner, unless it is already listed under KNOWN FACTS.
- Canadian spelling (jewellery, colour). No more than 2 emojis per caption, chosen from: ✨ 💛 🤍 🎁 📦 🌿.
- Do not put a price in captions unless one is given under KNOWN FACTS.

Reply with ONLY a JSON object with exactly these keys:
{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "subcategory": "e.g. stackable, statement, tennis, cuban, paperclip, hoop, signet",
  "gender": "women" | "men" | "unisex",
  "colour_finish": "the colour and finish you can see, for example yellow, polished",
  "stones": "only stones you can clearly see, or an empty string if none are visible",
  "name_suggestions": [3 short, elegant product names],
  "style_tags": [3-6 lowercase tags],
  "occasion_tags": [2-5 lowercase tags],
  "short_desc": "one sentence, max 20 words",
  "long_desc": "2-4 sentences for a product page; mention the plating only when the rules above allow it",
  "care_notes": "2-3 short sentences",
  "captions": [3 different Instagram captions following the caption formula in the brand guide, WITHOUT hashtags],
  "hashtags": [10-14 hashtags including the local and brand pools, each starting with #],
  "alt_text": "one sentence describing the photo for accessibility",
  "owner_questions": [questions for the owner],
  "marks_seen": [every brand name, logo, hallmark or engraved text visible on the piece, copied exactly; empty list if none]
}`;
}

export async function analyseProduct(
  p: Product,
  images: ProductImage[]
): Promise<{ result: AnalysisResult; demo: boolean }> {
  if (!visionProvider()) return { result: demoAnalysis(p), demo: true };

  const brand = await loadBrand();
  const photos = await Promise.all(
    images.slice(0, 4).map(async (img) => toModelJpeg(await fs.readFile(uploadPath(img.path)), 1280))
  );
  const text = await askVision(buildPrompt(p, brand), photos, { temperature: 0.6 });
  return { result: Analysis.parse(parseJsonLoose(text)), demo: false };
}

/**
 * No AI key: fill the product from templates (src/lib/captions.ts) using its own facts, so the text is usable as-is.
 * It cannot see the photo, so anything visual is left for the owner (see owner_questions).
 */
function demoAnalysis(p: Product): AnalysisResult {
  const category = p.category;
  const facts = { name: p.name, category, price_cad: p.price_cad, sizes: p.sizes, plating: p.plating, colour_finish: p.colour_finish };
  const gender = (["women", "men", "unisex"] as const).find((g) => g === p.gender) ?? "unisex";
  return {
    category: p.category === "other" ? "ring" : p.category,
    subcategory: "demo",
    gender: "women",
    colour_finish: "", // never invent a finish in demo mode; the [DEMO] markers below also block "ready"
    stones: "",
    name_suggestions: [`${name}`, `${name} Classic`, `${name} Everyday`],
    style_tags: ["minimal", "everyday", "layering"],
    occasion_tags: ["gift", "daily wear"],
    ...templateDescriptions(facts),
    care_notes: "Put it on last and take it off first, including before showering, swimming and workouts. Wipe with a soft dry cloth and store it separately.",
    captions: templateCaptions(facts),
    hashtags: templateHashtags(category),
    alt_text: templateAltText(facts),
    owner_questions: [
      ...(category === "other" ? ["What kind of piece is it (ring, necklace, earrings, set…)?"] : []),
      "Is it for women, men or both?",
      "What colour and finish is it, and does it have stones?",
      "What is the base metal under the plating?",
      "What sizes or lengths is it available in?",
      "Is it nickel-free?",
    ],
    // Without AI nothing can be read from the photo, so any marks the owner already recorded are kept as they are.
    marks_seen: p.marks_seen,
  };
}

/** Writes AI output into a product patch without touching price, stock, status, SKU or owner-confirmed facts. */
export function analysisToPatch(a: AnalysisResult, p: Product): Record<string, unknown> {
  return {
    category: p.category === "other" ? a.category : p.category,
    subcategory: a.subcategory,
    gender: a.gender,
    colour_finish: a.colour_finish,
    stones: a.stones,
    name: p.name || a.name_suggestions[0] || "",
    name_suggestions: a.name_suggestions,
    style_tags: a.style_tags,
    occasion_tags: a.occasion_tags,
    short_desc: a.short_desc,
    long_desc: a.long_desc,
    care_notes: a.care_notes,
    captions: a.captions,
    hashtags: a.hashtags,
    alt_text: a.alt_text,
    owner_questions: a.owner_questions,
    // Marks the owner or an earlier run recorded are never dropped: new ones are added, exactly as read.
    marks_seen: mergeMarks(p.marks_seen, a.marks_seen),
  };
}

/** Same mark, different spacing or capitals ("TIFFANY & Co." and "TIFFANY&Co."): keep the first one written. */
export function mergeMarks(existing: string[], found: string[]): string[] {
  const key = (m: string) => m.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of [...existing, ...found].map((x) => x.trim()).filter(Boolean)) {
    const k = key(m);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}
