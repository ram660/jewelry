import Anthropic from "@anthropic-ai/sdk";
import { claudeEffort, claudeModel } from "../config";

/** The SDK reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, used by tests) from the environment. */
let cached: Anthropic | undefined;
const client = () => (cached ??= new Anthropic({ maxRetries: 2, timeout: 120_000 }));

const SYSTEM = "Reply with ONLY a single JSON object. No markdown fences and no commentary before or after it.";

/** Never let a key appear in an error message. */
const scrub = (s: string) => s.replace(/sk-ant-[\w-]+/g, "[key]").slice(0, 300);

function friendly(e: unknown): Error {
  // Most specific first; the SDK maps 529 (overloaded) to InternalServerError.
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) {
      return new Error("Your Anthropic account has no credit. Add credit under Billing in the Anthropic Console (console.anthropic.com).");
    }
    return new Error(`Claude rejected the request: ${scrub(e.message)}`);
  }
  if (e instanceof Anthropic.AuthenticationError) return new Error("Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.local.");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error(`Claude refused access (403): ${scrub(e.message)}`);
  if (e instanceof Anthropic.NotFoundError) return new Error(`Claude model “${claudeModel()}” was not found. Check CLAUDE_MODEL in .env.local.`);
  if (e instanceof Anthropic.RateLimitError) return new Error("Claude rate limit reached. Wait a minute and try again.");
  if (e instanceof Anthropic.InternalServerError) {
    return new Error(e.status === 529 ? "Claude is overloaded right now. Try again in a minute." : `Claude had a server problem (${e.status}). Try again.`);
  }
  if (e instanceof Anthropic.APIConnectionError) return new Error("Could not reach Claude. Check your internet connection.");
  if (e instanceof Anthropic.APIError) return new Error(`Claude request failed (${e.status}): ${scrub(e.message)}`);
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Asks Claude about some JPEG photos and returns its reply text (a JSON object, by instruction).
 * Opus 5.5 takes no sampling parameters (temperature etc. are rejected), so none are sent.
 */
export async function claudeJson(prompt: string, jpegs: Buffer[], opts: { effort?: "low" | "medium" | "high" } = {}): Promise<string> {
  const request = (withFallbacks: boolean) =>
    client().beta.messages.create({
      model: claudeModel(),
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: opts.effort ?? claudeEffort() },
      // Safety classifiers can decline; let the API re-run a declined request on Anthropic's fallback model.
      ...(withFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: [
        {
          role: "user",
          content: [
            // Photos first, then the question.
            ...jpegs.map((b) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") },
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    });

  let res;
  try {
    try {
      res = await request(true);
    } catch (e) {
      // If the account can't use the fallback beta, retry once without it rather than failing the whole task.
      if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message) && !/credit balance/i.test(e.message)) {
        res = await request(false);
      } else {
        throw e;
      }
    }
  } catch (e) {
    throw friendly(e);
  }

  if (res.stop_reason === "refusal") {
    const why = res.stop_details?.category ? ` (${res.stop_details.category})` : "";
    throw new Error(`Claude declined this request${why}. Try different photos or wording.`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("The AI reply was cut off. Try again.");

  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("Claude returned an empty reply.");
  return text;
}
