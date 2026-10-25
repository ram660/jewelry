// Things the owner confirms against the real photo before approving a picture that was cut out or generated.
// Pure helper (no Node imports): it runs in the browser. Wording follows docs/BRAND.md and src/lib/claims.ts.

const COMMON = [
  "Colour and finish match my real piece",
  "Nothing added, removed or reshaped on the piece",
];

const BY_CATEGORY: Record<string, string[]> = {
  ring: ["Band width and shape match", "Stone count, shape and setting match"],
  earring: ["Both earrings match each other (symmetry)", "Stone count, shape and setting match", "Post, hook or hoop style matches"],
  necklace: ["Chain link style and length look right", "Pendant shape and any stones match", "Clasp matches (if it shows)"],
  chain: ["Chain link style and thickness match", "Clasp matches (if it shows)"],
  bracelet: ["Link or bangle style matches", "Stone count and setting match", "Clasp matches (if it shows)"],
  anklet: ["Chain link style matches", "Clasp matches (if it shows)"],
  set: ["Every piece in the set is shown and matches"],
};

// Kinds that start from AI or a cutout. Originals, touch-ups and code-drawn cards need no checklist.
const CHECKED_KINDS = ["clean", "scene", "on_model", "scale"];

const EXTRA_BY_KIND: Record<string, string[]> = {
  clean: ["Edges and chain gaps are cut out cleanly"],
  scene: ["Edges look natural against the backdrop"],
  on_model: ["Sits naturally on the skin, with no odd hands or fingers", "Looks the right size on the body"],
  scale: ["Proportions match the real size of my piece"],
};

export function needsChecklist(kind: string): boolean {
  return CHECKED_KINDS.includes(kind);
}

export function checklistFor(category: string, kind: string): string[] {
  if (!needsChecklist(kind)) return [];
  return [...COMMON, ...(BY_CATEGORY[category] ?? []), ...(EXTRA_BY_KIND[kind] ?? [])];
}
