export const CATEGORIES = [
  "ring",
  "bracelet",
  "chain",
  "necklace",
  "earring",
  "anklet",
  "set",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const GENDERS = ["women", "men", "unisex"] as const;
export const STATUSES = ["draft", "ready", "scheduled", "posted", "sold_out", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: Category;
  subcategory: string;
  gender: string;
  plating: string;
  base_metal: string;
  plating_microns: string;
  nickel_free: boolean | null;
  colour_finish: string;
  stones: string;
  sizes: string;
  weight_g: number | null;
  price_cad: number | null;
  cost_cad: number | null;
  compare_at_cad: number | null;
  stock_qty: number;
  low_stock_at: number;
  status: Status;
  hypoallergenic: boolean | null;
  anti_tarnish: boolean | null;
  style_tags: string[];
  occasion_tags: string[];
  name_suggestions: string[];
  short_desc: string;
  long_desc: string;
  care_notes: string;
  captions: string[];
  hashtags: string[];
  alt_text: string;
  owner_questions: string[];
  analysed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ImageKind =
  | "original" | "enhanced" | "clean" | "cutout" | "studio" | "scene" | "on_model" | "scale" | "price_card" | "poster";

export const KIND_LABEL: Record<string, string> = {
  original: "Original",
  enhanced: "Touched up",
  clean: "Clean background",
  cutout: "Transparent cut-out",
  studio: "Studio shot",
  poster: "Poster",
  scene: "Scene",
  on_model: "On model",
  scale: "Scale",
  price_card: "Info card",
};

export interface ProductImage {
  id: number;
  product_id: number;
  kind: ImageKind;
  path: string;
  thumb_path: string;
  sort_order: number;
  approved: boolean;
  label: string | null;
  prompt_used: string | null;
  model_used: string | null;
  fidelity_score: number | null;
  fidelity_notes: string | null;
  source_image_id: number | null;
  carousel_pos: number | null;
}

/** Instagram allows at most 10 items per carousel through the API. */
export const MAX_CAROUSEL = 10;

export const imageUrl = (p: string) => `/api/files/${p}`;
