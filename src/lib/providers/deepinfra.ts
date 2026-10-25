import { deepinfraBase, visionModel } from "../config";

/**
 * Asks a vision-language model about some images and returns its reply text (JSON mode).
 * DeepInfra speaks the OpenAI chat-completions format. Images are sent inline as base64 JPEGs.
 */
export async function visionJson(
  prompt: string,
  jpegs: Buffer[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const res = await fetch(`${deepinfraBase()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: visionModel(),
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 3000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...jpegs.map((b) => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("DeepInfra rejected the API key. Check DEEPINFRA_API_KEY in .env.local.");
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`DeepInfra request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = json.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error("DeepInfra returned an empty reply.");
  if (choice?.finish_reason === "length") throw new Error("The AI reply was cut off. Try again.");
  return text;
}
