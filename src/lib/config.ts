/**
 * Provider settings. Model IDs live in .env.local, not in code, because hosts rename and retire models.
 *
 * Two jobs, chosen separately:
 *   VISION  = reading photos and deciding things: product details, captions, match scores (and later the DM bot)
 *   IMAGE   = making pictures: scenes, on-model, scale shots
 *
 * VISION_PROVIDER: claude | gemini | deepinfra | demo | auto
 * IMAGE_PROVIDER : gemini | fal | demo | auto
 * AI_PROVIDER    : the older all-in-one switch, used when the two above are "auto":
 *   gemini : Gemini for both       open : DeepInfra + fal.ai       demo : no AI
 *   auto   : (default) Claude if its key is set, else DeepInfra, else Gemini; pictures: fal.ai, else Gemini
 *
 * Claude cannot make pictures, so IMAGE is always Gemini or fal.ai.
 */

const has = (name: string) => Boolean(process.env[name]);
const env = (name: string, fallback = "auto") => (process.env[name] || fallback).trim().toLowerCase();

export const claudeConfigured = () => has("ANTHROPIC_API_KEY");
export const geminiConfigured = () => has("GEMINI_API_KEY");
export const falConfigured = () => has("FAL_KEY");
export const deepinfraConfigured = () => has("DEEPINFRA_API_KEY");

export type VisionProvider = "claude" | "gemini" | "deepinfra" | null;
export type ImageProvider = "gemini" | "fal" | null;

const legacy = () => env("AI_PROVIDER");

/** Who reads photos and makes decisions. */
export function visionProvider(): VisionProvider {
  switch (env("VISION_PROVIDER")) {
    case "demo": return null;
    case "claude": return claudeConfigured() ? "claude" : null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "deepinfra":
    case "open": return deepinfraConfigured() ? "deepinfra" : null;
  }
  switch (legacy()) {
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "open": return deepinfraConfigured() ? "deepinfra" : null;
    default:
      return claudeConfigured() ? "claude" : deepinfraConfigured() ? "deepinfra" : geminiConfigured() ? "gemini" : null;
  }
}

/** Who makes the pictures. */
export function imageProvider(): ImageProvider {
  switch (env("IMAGE_PROVIDER")) {
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "fal":
    case "open": return falConfigured() ? "fal" : null;
  }
  switch (legacy()) {
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "open": return falConfigured() ? "fal" : null;
    default: return falConfigured() ? "fal" : geminiConfigured() ? "gemini" : null;
  }
}

/**
 * Safe-mode scenes keep your real pixels. The cutout is local (or fal.ai) and the empty backdrop comes from
 * the active image provider (Gemini or fal.ai), so any image provider is enough.
 */
export const safeModeAvailable = () => imageProvider() !== null;

// Claude. Opus 5.5 is the default; cheaper Sonnet/Haiku are one setting away (see .env.example).
export const claudeModel = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const claudeEffort = (): "low" | "medium" | "high" => {
  const e = env("CLAUDE_EFFORT", "medium");
  return e === "low" || e === "high" ? e : "medium";
};

// Gemini
export const geminiTextModel = () => process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";
export const geminiImageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
export const geminiBase = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

// fal.ai: image editing, cutouts, backdrops
export const editModel = () => process.env.FAL_EDIT_MODEL || "fal-ai/qwen-image-edit-plus";
export const cutoutModel = () => process.env.FAL_CUTOUT_MODEL || "fal-ai/birefnet/v2";
/** BiRefNet variant and working resolution (see the model's page on fal.ai for the allowed values). */
export const cutoutVariant = () => process.env.FAL_CUTOUT_VARIANT || "General Use (Heavy)";
export const cutoutResolution = () => process.env.FAL_CUTOUT_RESOLUTION || "2048x2048";
export const backdropModel = () => process.env.FAL_BACKDROP_MODEL || "fal-ai/flux/schnell";

/**
 * How the jewellery is cut out of a photo (always from your own pixels, never redrawn):
 *   auto  BiRefNet on this computer when it has been installed (node scripts/get-birefnet.mjs lite), otherwise the
 *         built-in gold-colour method; fal.ai's BiRefNet when fal is the image provider or nothing local can find the piece
 *   local BiRefNet on this computer only      gold  the built-in gold-colour method only      fal  fal.ai only
 */
export type CutoutMode = "auto" | "local" | "gold" | "fal";
export const cutoutMode = (): CutoutMode => {
  const v = env("CUTOUT_MODE", "auto");
  return v === "local" || v === "gold" || v === "fal" ? v : "auto";
};

// DeepInfra: reads photos
export const visionModel = () => process.env.DEEPINFRA_VISION_MODEL || "Qwen/Qwen3-VL-30B-A3B-Instruct";

/** Base URLs can be overridden for testing against a local mock. */
export const falBase = () => (process.env.FAL_QUEUE_URL || "https://queue.fal.run").replace(/\/+$/, "");
export const deepinfraBase = () =>
  (process.env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1/openai").replace(/\/+$/, "");

/** Name of the image model in use, for display and for recording on each generated image. */
export function activeImageModel(): string {
  const p = imageProvider();
  return p === "gemini" ? geminiImageModel() : p === "fal" ? editModel() : "demo";
}

/** Name of the vision model in use, for display. */
export function activeVisionModel(): string {
  const p = visionProvider();
  return p === "claude" ? claudeModel() : p === "gemini" ? geminiTextModel() : p === "deepinfra" ? visionModel() : "demo";
}
