import { openrouterBase, openrouterModels } from "../config";

/**
 * Asks a vision model on OpenRouter about some images and returns its reply text (JSON mode).
 * OpenRouter speaks the OpenAI chat-completions format and can try several models in order, so a free model that is
 * busy or rate limited hands over to the next one in the list (OPENROUTER_MODELS) inside one request.
 *
 * Free models are reasoning models: they "think" before they answer, and that thinking counts against max_tokens. A small
 * limit gives an empty answer, so the limit is never lower than MIN_TOKENS here.
 *
 * Only owner-supplied product photos and the app's own prompts go through here. Customer messages never do.
 */

const MIN_TOKENS = 6000;

function scrub(text: string): string {
  const key = process.env.OPENROUTER_API_KEY;
  return key ? text.split(key).join("[key]") : text;
}

export async function openrouterJson(
  prompt: string,
  jpegs: Buffer[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in .env.local.");
  let models = openrouterModels();
  const strict = (process.env.OPENROUTER_PRIVACY || "").trim().toLowerCase() === "strict";

  // Free models are retired often, and OpenRouter answers 400 "<id> is not a valid model ID" for a retired one with no fallback.
  // Drop it and carry on with the rest, so one stale entry in the list cannot stop photo reading.
  for (let attempt = 0; ; attempt++) {
    const out = await post(key, models, jpegs, prompt, opts, strict);
    const invalid = out.res.status === 400 ? out.json?.error?.message?.match(/(\S+) is not a valid model ID/i)?.[1] : undefined;
    if (invalid && models.length > 1 && attempt < 3) {
      models = models.filter((m) => m !== invalid);
      continue;
    }
    return finish(out);
  }
}

interface Out {
  res: Response;
  raw: string;
  json: {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    error?: { message?: string; code?: number; metadata?: { raw?: string } };
  } | null;
}

async function post(
  key: string, models: string[], jpegs: Buffer[], prompt: string, opts: { temperature?: number; maxTokens?: number }, strict: boolean
): Promise<Out> {
  let res: Response;
  try {
    res = await fetch(`${openrouterBase()}/chat/completions`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "EFJ Studio" },
      body: JSON.stringify({
        models,
        temperature: opts.temperature ?? 0.3,
        max_tokens: Math.max(opts.maxTokens ?? 0, MIN_TOKENS),
        response_format: { type: "json_object" },
        // "strict" only uses providers that promise not to keep or train on prompts. Few free models qualify.
        ...(strict ? { provider: { data_collection: "deny" } } : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...jpegs.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new Error(scrub(`Could not reach OpenRouter: ${e instanceof Error ? e.message : String(e)}`));
  }

  const raw = await res.text();
  let json: Out["json"] = null;
  try { json = JSON.parse(raw); } catch { /* not JSON */ }
  return { res, raw, json };
}

function finish({ res, raw, json }: Out): string {
  if (!res.ok || json?.error) {
    const detail = scrub(`${json?.error?.message ?? ""} ${json?.error?.metadata?.raw ?? ""}${json ? "" : raw}`).replace(/\s+/g, " ").trim().slice(0, 300);
    if (res.status === 401) throw new Error("OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.local.");
    if (res.status === 402) throw new Error("OpenRouter says this account has no credits for that model. Free models (ending in :free) need none.");
    if (res.status === 429 || /per-day|rate.?limit/i.test(detail)) {
      throw new Error(
        "OpenRouter's free usage limit is reached (20 requests a minute, 50 a day until credits are bought). Wait a little, or buy $10 of credits for 1,000 a day."
      );
    }
    throw new Error(`OpenRouter request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }

  const choice = json?.choices?.[0];
  // Some models print their reasoning inside <think> tags. Keep only the answer.
  const text = (choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new Error("The AI model sent an empty reply (it may have used its whole token budget thinking). Try again.");
  if (choice?.finish_reason === "length") throw new Error("The AI reply was cut off. Try again.");
  return text;
}
