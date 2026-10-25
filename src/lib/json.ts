/** Parses JSON from a model reply, tolerating ```json fences and text around the object. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const unfenced = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
  throw new Error("The AI reply was not valid JSON.");
}
