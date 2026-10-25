import { SCALE_PRESET, SCENES, SKIN_TONES, posesFor } from "./presets";
import type { Category } from "./types";

/**
 * A prompt the owner pastes into the Gemini app (gemini.google.com) together with photos of the piece, so Gemini draws
 * a new picture around the real piece. Pure text, no network: the Studio only builds the prompt and the owner pastes it.
 *
 * The prompt tells Gemini to keep the piece exactly as photographed, including every engraving, letter, logo, hallmark
 * and stone. Nothing on the piece is ever to be removed or changed, and any marks already recorded for the piece are
 * listed by name so they are not overlooked.
 */

export interface PromptFacts {
  category: Category;
  gender?: string;
  colour_finish?: string;
  stones?: string;
  /** Marks seen on the piece, copied exactly as they appear. They are listed in the prompt so they are kept. */
  marks_seen?: string[];
}

export interface GeminiStyle {
  id: string;
  label: string;
  group: "Product shots" | "Worn" | "Size";
}

/** Product-shot backdrops that are not in the scene presets: the same looks the Studio draws by code. */
const STUDIO_LOOKS: { id: string; label: string; scene: string }[] = [
  { id: "cream", label: "Cream studio", scene: "on a soft cream studio background with a gentle glow behind the piece, even soft light and a faint soft shadow under it" },
  { id: "gloss", label: "White glossy surface", scene: "standing on a clean white glossy surface that shows a soft mirror reflection of the piece, bright even light" },
  { id: "dark", label: "Dark spotlight", scene: "on a dark charcoal studio background lit by one soft spotlight, with a subtle glossy reflection beneath the piece" },
];

const SCENE_LABEL = (id: string) => SCENES.find((s) => s.id === id)?.label ?? id;

/** Everything the owner can pick, in the order shown. Worn styles depend on the kind of piece. */
export function geminiStyles(category: Category, gender = "women"): GeminiStyle[] {
  return [
    ...STUDIO_LOOKS.map((l) => ({ id: `look:${l.id}`, label: l.label, group: "Product shots" as const })),
    ...SCENES.map((s) => ({ id: `scene:${s.id}`, label: SCENE_LABEL(s.id), group: "Product shots" as const })),
    ...posesFor(category, gender).map((p) => ({ id: `worn:${p.id}`, label: p.label, group: "Worn" as const })),
    { id: "scale", label: SCALE_PRESET.label, group: "Size" as const },
  ];
}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function sceneText(id: string, category: Category, gender: string, skinId: string | undefined): string {
  if (id === "scale") return SCALE_PRESET.prompt;
  if (id.startsWith("look:")) {
    const l = STUDIO_LOOKS.find((x) => `look:${x.id}` === id);
    if (l) return l.scene;
  }
  if (id.startsWith("scene:")) {
    const s = SCENES.find((x) => `scene:${x.id}` === id);
    if (s) return s.prompt;
  }
  if (id.startsWith("worn:")) {
    const p = posesFor(category, gender).find((x) => `worn:${x.id}` === id);
    if (p) {
      const skin = SKIN_TONES.find((t) => t.id === skinId);
      return skin ? `shown on ${skin.prompt}: ${p.prompt}` : p.prompt;
    }
  }
  throw new Error(`Unknown style "${id}".`);
}

/** Builds the full prompt text. `photos` is how many photos the owner will attach. */
export function buildGeminiPrompt(
  facts: PromptFacts,
  styleId: string,
  o: { photos: number; skin?: string; extra?: string } = { photos: 1 }
): string {
  const scene = sceneText(styleId, facts.category, facts.gender ?? "women", o.skin);
  const kind = facts.category === "other" ? "piece of jewellery" : facts.category;
  const details = [clean(facts.colour_finish, 80), clean(facts.stones, 120) && `stones: ${clean(facts.stones, 120)}`].filter(Boolean).join("; ");
  const photos = Math.max(1, Math.trunc(o.photos) || 1);
  const marks = (facts.marks_seen ?? []).map((m) => clean(m, 120)).filter(Boolean);
  const extra = clean(o.extra, 300);

  return [
    `I am attaching ${photos} photo${photos === 1 ? "" : "s"} of ONE real ${kind}${details ? ` (${details})` : ""}. Use the photo${photos === 1 ? "" : "s"} as the exact reference for the piece.`,
    ``,
    `TASK: Create a new photograph of exactly this piece, ${scene}.`,
    ``,
    `KEEP THE PIECE EXACTLY AS IT IS IN MY PHOTOS:`,
    `- Same shape, proportions, thickness, chain or link pattern, clasp, finish and metal colour.`,
    `- Keep every engraving, letter, number, logo, hallmark, monogram, stone and surface detail exactly as photographed. Do not remove, blur, change, translate, redraw or add any of them.${marks.length ? ` The marks on this piece are: ${marks.map((m) => `"${m}"`).join(", ")}. They must stay exactly as written, in the same place and style.` : ""}`,
    `- Do not add, remove, simplify or redesign any part of the piece, and do not change how many pieces there are.`,
    `- Keep the piece sharp, in focus and clearly the hero of the picture.`,
    ``,
    `LOOK: photorealistic, premium product and Instagram photography, portrait 4:5 (1080 x 1350), soft natural light, elegant and uncluttered. No text, captions, watermark or logo of your own, and no extra jewellery or props except what is described above.`,
    extra ? `` : null,
    extra ? `ALSO: ${extra}` : null,
    ``,
    `If you cannot keep the piece exactly the same as in my photos, tell me what is different instead of guessing.`,
  ].filter((l): l is string => l !== null).join("\n");
}

/** The three steps shown beside the prompt. */
export const GEMINI_STEPS = [
  "Open Gemini (the button below) and start a new chat.",
  "Attach the photos of this piece: the button below downloads them, or drag them in from your catalog.",
  "Paste the prompt, send it, and download the picture you like. Ask for changes in the same chat.",
] as const;

export const GEMINI_URL = "https://gemini.google.com/app";
