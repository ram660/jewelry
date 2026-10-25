import type { Product } from "./types";

/**
 * Captions and hashtags from templates, filled with the product's own facts (no AI). Used when no AI key is active,
 * so the owner still gets post-ready text. Follows docs/BRAND.md: Canadian spelling, the product's plating wording,
 * at most two emojis from the approved set, no price unless one is set, and nothing the owner hasn't confirmed.
 */

const NOUN: Record<string, string> = {
  ring: "ring", bracelet: "bracelet", chain: "chain", necklace: "necklace", earring: "pair of earrings",
  anklet: "anklet", set: "set", other: "piece",
};

// Every tag says "plated" or "tone": a bare "#gold…" tag reads like a solid-gold claim.
const CATEGORY_TAGS: Record<string, string[]> = {
  ring: ["#goldplatedrings", "#stackingrings", "#ringstack"],
  bracelet: ["#goldplatedbracelet", "#braceletstack", "#armcandy"],
  chain: ["#goldplatedchain", "#layerednecklaces", "#chainnecklace"],
  necklace: ["#goldplatednecklace", "#layerednecklaces", "#pendantnecklace"],
  earring: ["#goldplatedearrings", "#studearrings", "#earringsoftheday"],
  anklet: ["#goldplatedanklet", "#summerjewellery", "#ankletlove"],
  set: ["#jewelleryset", "#matchingjewellery", "#giftset"],
  other: ["#goldtonejewellery", "#minimaljewellery", "#everydayjewellery"],
};

const BRAND_TAGS = ["#ElegantFashionJewellery"];
const LOCAL_TAGS = ["#vancouverjewellery", "#yvrstyle", "#vancouverstyle", "#shopsmallyvr", "#canadianjewellery"];
const GENERAL_TAGS = ["#goldplatedjewellery", "#everydayjewellery", "#giftideas"];

type Facts = Pick<Product, "name" | "category" | "price_cad" | "sizes"> & Partial<Pick<Product, "plating" | "colour_finish">>;

const priceLine = (p: Facts) => (p.price_cad != null && p.price_cad > 0 ? `$${Number.isInteger(p.price_cad) ? p.price_cad : p.price_cad.toFixed(2)} CAD. ` : "");
const sizeLine = (p: Facts) => (p.sizes?.trim() ? `Available in ${p.sizes.trim()}. ` : "");
const plating = (p: Facts) => p.plating?.trim() || "10K gold-plated";
/** Only describe the colour once the owner has confirmed a yellow/gold finish. */
const finish = (p: Facts) => (/\b(?:yellow|gold)\b/i.test(p.colour_finish ?? "") ? " with a warm gold-tone finish" : "");

/** "The Aria Ring" / "The Classic Set" (name already starts with "The") / "This piece" (no name). */
function names(p: Facts) {
  const name = p.name?.trim();
  if (!name) return { subject: "This piece", object: "it" };
  const withThe = /^the\s/i.test(name) ? name : `The ${name}`;
  return { subject: withThe, object: withThe.replace(/^The\s/, "the ") };
}

export function templateCaptions(p: Facts): string[] {
  const { subject, object } = names(p);
  const noun = NOUN[p.category] ?? "piece";
  const pl = plating(p);
  return [
    `Everyday elegance ✨\n\n${subject} is a ${pl} ${noun} for a polished look from morning coffee to dinner out.\n\n${priceLine(p)}${sizeLine(p)}DM us to order 💛`,
    `Made for layering 🤍\n\nPair ${object} with your favourite pieces, or let it shine on its own. ${pl.charAt(0).toUpperCase() + pl.slice(1)}${finish(p)}.\n\n${priceLine(p)}Comment ✨ for details.`,
    `A gift worth wrapping 🎁\n\n${subject}: ${pl} and easy to love. A thoughtful pick for birthdays, anniversaries or just because.\n\n${priceLine(p)}DM us to order.`,
  ];
}

export function templateHashtags(category: string): string[] {
  return [...BRAND_TAGS, ...LOCAL_TAGS, ...(CATEGORY_TAGS[category] ?? CATEGORY_TAGS.other), ...GENERAL_TAGS.filter((t) => !(CATEGORY_TAGS[category] ?? []).includes(t))];
}

export function templateDescriptions(p: Facts) {
  const { subject } = names(p);
  const noun = NOUN[p.category] ?? "piece";
  const pl = plating(p);
  return {
    short_desc: `${subject}: a ${pl} ${noun} for everyday wear.`,
    long_desc: `${subject} is a ${pl} ${noun}${finish(p)}. Wear it on its own for a clean, minimal look, or layer it with your favourite pieces.`,
  };
}

/** Alt text that doesn't pretend to know what the photo shows. */
export function templateAltText(p: Facts) {
  const noun = NOUN[p.category] ?? "piece of jewellery";
  return p.name?.trim() ? `Photo of ${p.name.trim()}, a ${plating(p)} ${noun}.` : `Photo of a ${plating(p)} ${noun}.`;
}
