/**
 * Provider settings. Model IDs live in .env.local, not in code, because hosts rename and retire models.
 *
 * Two jobs, chosen separately:
 *   VISION  = reading photos and deciding things: product details, captions, match scores (and later the DM bot)
 *   IMAGE   = making pictures: scenes, on-model, scale shots
 *
 * VISION_PROVIDER: claude | gemini | deepinfra | demo | auto
 * IMAGE_PROVIDER : gemini | fal | none | auto  (none = no AI pictures at all; "auto" never picks Gemini by itself)
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
export const openrouterConfigured = () => has("OPENROUTER_API_KEY");

export type VisionProvider = "claude" | "gemini" | "deepinfra" | "openrouter" | null;
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
    case "openrouter": return openrouterConfigured() ? "openrouter" : null;
  }
  switch (legacy()) {
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "open": return deepinfraConfigured() ? "deepinfra" : null;
    default:
      // OpenRouter comes last in "auto" so adding its key never silently replaces a provider you already use.
      // Choose it on purpose with VISION_PROVIDER=openrouter.
      return claudeConfigured() ? "claude" : deepinfraConfigured() ? "deepinfra" : geminiConfigured() ? "gemini" : openrouterConfigured() ? "openrouter" : null;
  }
}

/** Who makes the pictures. */
export function imageProvider(): ImageProvider {
  switch (env("IMAGE_PROVIDER")) {
    // "none" and "demo" both mean: no AI makes any picture. Scenes use your real cutout on a backdrop drawn by code.
    case "none":
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "fal":
    case "open": return falConfigured() ? "fal" : null;
  }
  switch (legacy()) {
    case "demo": return null;
    case "gemini": return geminiConfigured() ? "gemini" : null;
    case "open": return falConfigured() ? "fal" : null;
    // In "auto" a Gemini key alone never switches picture-making on, so a key used for reading photos cannot start
    // spending on images by accident. Choose Gemini for pictures on purpose with IMAGE_PROVIDER=gemini.
    default: return falConfigured() ? "fal" : null;
  }
}

/**
 * Safe-mode scenes keep your real pixels. The cutout is BiRefNet (on this computer or fal.ai) or the free gold-colour
 * method. The backdrop comes from the image provider when there is one, and is drawn by code (lib/backdrops.ts) when
 * there is not, so safe mode is always available.
 */
export const safeModeAvailable = () => true;

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
  const v = env("CUTOUT_MODE", "auto").toLowerCase();
  return v === "local" || v === "gold" || v === "fal" ? v : "auto";
};

// DeepInfra: reads photos
export const visionModel = () => process.env.DEEPINFRA_VISION_MODEL || "Qwen/Qwen3-VL-30B-A3B-Instruct";

// OpenRouter: one key, many models. The free vision models below were measured on this app's own two jobs
// (scripts/bench-models.mts, docs/REFERENCES.md). They are tried in order, so a busy or rate-limited one hands over to the next.
// Both scored 15/15 on writing product details and told faithful from altered pictures. The first is more than twice as fast.
// Defaults are free models only, so a failure never falls through to a model that costs money. A paid option is in docs/REFERENCES.md.
export const DEFAULT_OPENROUTER_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "nvidia/nemotron-3.5-super-vl:free",
];
export const openrouterModels = (): string[] => {
  const list = (process.env.OPENROUTER_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return (list.length ? list : DEFAULT_OPENROUTER_MODELS).slice(0, 3); // OpenRouter accepts at most 3 fallbacks
};
export const openrouterBase = () => (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");

// Instagram inbox (see docs/INSTAGRAM.md). The Studio only ever makes outbound requests: it pulls from the relay and sends replies.
export const relayUrl = () => (process.env.RELAY_URL || "").trim().replace(/\/+$/, "");
export const relayConfigured = () => Boolean(relayUrl()) && has("RELAY_PULL_TOKEN");
export const igTokenConfigured = () => has("IG_ACCESS_TOKEN");
/** "off" (default): replies are approved here and sent by hand in the Instagram app. "live": approved replies are sent through the API. */
export const igSendMode = (): "off" | "live" => (env("IG_SEND_MODE", "off") === "live" ? "live" : "off");
export const igApiBase = () =>
  (process.env.IG_API_BASE || `https://graph.instagram.com/${process.env.IG_API_VERSION || "v24.0"}`).replace(/\/+$/, "");

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
  return p === "claude" ? claudeModel() : p === "gemini" ? geminiTextModel() : p === "deepinfra" ? visionModel() : p === "openrouter" ? openrouterModels()[0] : "demo";
}
