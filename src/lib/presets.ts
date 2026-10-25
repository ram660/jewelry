import type { Category } from "./types";

export interface Preset {
  id: string;
  label: string;
  /** Scene description inserted into the image prompt. {p} becomes "woman's" or "man's". */
  prompt: string;
}

/** Styled backgrounds with a Vancouver / West Coast flavour. */
export const SCENES: Preset[] = [
  { id: "marble", label: "White marble",
    prompt: "resting on a polished white marble surface with soft grey veining, bright diffused window light" },
  { id: "linen", label: "Warm linen",
    prompt: "on warm cream linen fabric with gentle folds, soft morning light" },
  { id: "cedar", label: "Cedar wood",
    prompt: "on a slab of weathered cedar wood with visible grain, warm side light, a West Coast feel" },
  { id: "rain-window", label: "Rainy window",
    prompt: "on a pale surface beside a rainy window, soft out-of-focus raindrops and grey-green bokeh behind" },
  { id: "sea-glass", label: "Sea glass & pebbles",
    prompt: "among smooth pebbles and pale sea glass on a beach, soft overcast coastal light" },
  { id: "golden-hour", label: "Golden hour",
    prompt: "in warm golden-hour sunlight with soft long shadows on a neutral stone surface" },
  { id: "velvet-box", label: "Velvet gift box",
    prompt: "presented in an open dark velvet gift box on a deep neutral background, a gentle spotlight" },
  { id: "festive-diwali", label: "Festive: Diwali",
    prompt: "styled with small brass diyas and marigold petals, a warm festive glow" },
  { id: "festive-red", label: "Festive: Lunar New Year",
    prompt: "on red silk with a small gold-foil accent, a Lunar New Year mood" },
];

/**
 * Empty-backdrop descriptions for "safe mode" scenes, where the real product is cut out of your photo and
 * placed on an AI-made background. They must describe the surface only, never the jewellery.
 */
export const SCENE_BACKDROP: Record<string, string> = {
  marble: "a polished white marble tabletop with soft grey veining, bright diffused window light",
  linen: "warm cream linen fabric with gentle folds, soft morning light",
  cedar: "a weathered cedar wood surface with visible grain, warm side light",
  "rain-window": "a pale tabletop beside a rainy window, soft out-of-focus raindrops and grey-green bokeh behind",
  "sea-glass": "smooth grey pebbles and pale sea glass on a beach, soft overcast coastal light",
  "golden-hour": "a neutral stone surface in warm golden-hour sunlight with soft long shadows",
  "velvet-box": "dark plum velvet fabric on a deep neutral background, a gentle spotlight",
  "festive-diwali": "a dark wooden surface with small brass diyas and marigold petals at the edges, a warm festive glow",
  "festive-red": "red silk fabric with a small gold-foil accent at the edge, a Lunar New Year mood",
};

/** Poses per category. {p} = woman's / man's. */
export const POSES: Record<Category, Preset[]> = {
  ring: [
    { id: "hand-rest", label: "Hand on knit sweater",
      prompt: "a {p} hand resting gently on a cream knit sweater, the ring worn on a finger, shallow depth of field" },
    { id: "hand-coffee", label: "Hand with coffee cup",
      prompt: "a {p} hand holding a ceramic coffee cup in a bright café, the ring worn on a finger" },
    { id: "hand-hair", label: "Fingers in hair",
      prompt: "a {p} fingers lightly touching their hair, the ring worn on a finger, soft natural light" },
  ],
  bracelet: [
    { id: "wrist-rest", label: "Wrist on linen",
      prompt: "a {p} wrist resting on cream linen, the bracelet worn on the wrist" },
    { id: "wrist-cuff", label: "Wrist from blazer cuff",
      prompt: "a {p} wrist emerging from a tailored blazer cuff, the bracelet worn on the wrist" },
  ],
  chain: [
    { id: "neck-collarbone", label: "Collarbone close-up",
      prompt: "a close crop of a {p} neck and collarbone, the chain worn around the neck, plain neckline" },
    { id: "neck-tee", label: "Over a white tee",
      prompt: "a chain worn over the neckline of a plain white t-shirt on a {p} neck" },
  ],
  necklace: [
    { id: "neck-collarbone", label: "Collarbone close-up",
      prompt: "a close crop of a {p} neck and collarbone, the necklace worn around the neck, plain neckline" },
    { id: "neck-tee", label: "Over a white tee",
      prompt: "a necklace worn over the neckline of a plain white t-shirt on a {p} neck" },
  ],
  earring: [
    { id: "ear-tucked", label: "Ear, hair tucked back",
      prompt: "a close crop of a {p} ear with hair tucked behind it, the earring worn in the ear" },
    { id: "ear-profile", label: "Side profile",
      prompt: "a side profile of a {p} face and jaw, the earring worn in the ear, soft light" },
  ],
  anklet: [
    { id: "ankle-sand", label: "Ankle on sand",
      prompt: "a {p} bare ankle and foot on pale sand, the anklet worn on the ankle" },
    { id: "ankle-sandal", label: "Ankle with sandal",
      prompt: "a {p} ankle in a simple leather sandal, the anklet worn on the ankle" },
  ],
  set: [
    { id: "neck-collarbone", label: "Neck & collarbone",
      prompt: "a close crop of a {p} neck and collarbone wearing the necklace from this set" },
    { id: "hand-rest", label: "Hand on knit sweater",
      prompt: "a {p} hand resting gently on a cream knit sweater wearing the ring or bracelet from this set" },
  ],
  other: [
    { id: "hand-rest", label: "Hand on knit sweater",
      prompt: "a {p} hand resting gently on a cream knit sweater, wearing the piece" },
    { id: "neck-collarbone", label: "Collarbone close-up",
      prompt: "a close crop of a {p} neck and collarbone, wearing the piece" },
  ],
};

export const SKIN_TONES = [
  { id: "fair", label: "Fair", prompt: "fair skin" },
  { id: "medium", label: "Medium / olive", prompt: "medium olive skin" },
  { id: "deep", label: "Deep brown", prompt: "deep brown skin" },
] as const;

export const SCALE_PRESET: Preset = {
  id: "scale",
  label: "Scale shot with a coin",
 
  prompt:
    "worn or held in a hand next to a Canadian one-dollar coin (loonie) for size comparison, plain neutral background, true-to-life proportions",
};

export const posesFor = (category: Category, gender: string): Preset[] =>
  POSES[category].map((p) => ({ ...p, prompt: p.prompt.replace("{p}", gender === "men" ? "man's" : "woman's") }));
