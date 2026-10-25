import { visionProvider } from "../config";
import { claudeJson } from "./claude";
import { geminiJson } from "./gemini";
import { visionJson } from "./deepinfra";
import { openrouterJson } from "./openrouter";

/**
 * Asks whichever vision provider is active about some JPEG photos. Returns the JSON reply text.
 * `temperature` applies to Gemini and DeepInfra only: Claude Opus 5.5 rejects sampling parameters.
 */
export async function askVision(
  prompt: string,
  jpegs: Buffer[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const provider = visionProvider();
  if (provider === "claude") return claudeJson(prompt, jpegs);
  if (provider === "gemini") return geminiJson(prompt, jpegs, opts);
  if (provider === "deepinfra") return visionJson(prompt, jpegs, opts);
  if (provider === "openrouter") return openrouterJson(prompt, jpegs, opts);
  throw new Error("No AI provider is configured. See Settings.");
}
