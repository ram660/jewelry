import { geminiBase, geminiImageModel, geminiTextModel } from "../config";

interface Part {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}
interface GeminiReply {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; message?: string };
}

/** Never let the key appear in an error message. */
function scrub(s: string): string {
  const key = process.env.GEMINI_API_KEY;
  let out = key ? s.split(key).join("[key]") : s;
  out = out.replace(/AQ\.[\w.-]{20,}|AIza[\w-]{20,}/g, "[key]");
  return out.slice(0, 300);
}

async function generate(model: string, generationConfig: object, prompt: string, jpegs: Buffer[], timeoutMs: number) {
  const res = await fetch(`${geminiBase()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...jpegs.map((b) => ({ inlineData: { mimeType: "image/jpeg", data: b.toString("base64") } })),
          ],
        },
      ],
      generationConfig,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let json: GeminiReply = {};
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: handled below
  }

  if (!res.ok) {
    const msg = json.error?.message ?? text;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error("Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.");
    if (res.status === 403) throw new Error(`Gemini refused the request (403): ${scrub(msg)}`);
    if (res.status === 404) throw new Error(`Gemini model “${model}” was not found. Check GEMINI_TEXT_MODEL / GEMINI_IMAGE_MODEL in .env.local.`);
    if (res.status === 429) throw new Error("Gemini rate limit or quota reached. Wait a minute, or check your plan and billing.");
    throw new Error(`Gemini request failed (${res.status}): ${scrub(msg)}`);
  }
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked this request (${json.promptFeedback.blockReason}). Try different photos or wording.`);
  }
  return json;
}

const partsOf = (j: GeminiReply) => j.candidates?.[0]?.content?.parts ?? [];

/** Asks Gemini about some photos and returns its reply text (JSON mode). */
export async function geminiJson(
  prompt: string,
  jpegs: Buffer[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const j = await generate(
    geminiTextModel(),
    { responseMimeType: "application/json", temperature: opts.temperature ?? 0.5, maxOutputTokens: opts.maxTokens ?? 8192 },
    prompt,
    jpegs,
    120_000
  );
  const reason = j.candidates?.[0]?.finishReason;
  const text = partsOf(j).map((p) => p.text ?? "").join("");
  if (!text) throw new Error(`Gemini returned an empty reply${reason ? ` (${reason})` : ""}.`);
  if (reason === "MAX_TOKENS") throw new Error("The AI reply was cut off. Try again.");
  return text;
}

/** Asks Gemini to make a picture from a prompt and reference photos. Returns the image bytes. */
export async function geminiImage(prompt: string, jpegs: Buffer[]): Promise<Buffer> {
  const j = await generate(
    geminiImageModel(),
    { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:5" } },
    prompt,
    jpegs,
    170_000
  );
  const parts = partsOf(j);
  const img = parts.find((p) => p.inlineData?.data);
  if (img?.inlineData?.data) return Buffer.from(img.inlineData.data, "base64");

  const reason = j.candidates?.[0]?.finishReason;
  const said = scrub(parts.map((p) => p.text ?? "").join(" ").trim());
  throw new Error(
    `Gemini returned no image${reason && reason !== "STOP" ? ` (${reason})` : ""}${said ? `: ${said}` : ". It may have declined this request; try again or change the scene."}`
  );
}
