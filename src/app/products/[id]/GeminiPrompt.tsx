"use client";

import { useEffect, useMemo, useState } from "react";
import { GEMINI_STEPS, GEMINI_URL, buildGeminiPrompt, geminiStyles, type PromptFacts } from "@/lib/geminiPrompt";
import { SKIN_TONES } from "@/lib/presets";

/**
 * A ready-to-paste prompt for the Gemini app. Gemini draws a new picture around the real piece; the prompt tells it to keep
 * every engraving, logo and stone exactly as photographed. The Studio itself calls no AI here.
 */
export default function GeminiPrompt({ productId, facts, photoCount }: { productId: number; facts: PromptFacts; photoCount: number }) {
  const styles = useMemo(() => geminiStyles(facts.category, facts.gender), [facts.category, facts.gender]);
  const [styleId, setStyleId] = useState("look:cream");
  const [skin, setSkin] = useState("");
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);

  // If the kind of piece changes, a "worn" style may no longer exist.
  useEffect(() => {
    if (!styles.some((s) => s.id === styleId)) setStyleId("look:cream");
  }, [styles, styleId]);

  const worn = styleId.startsWith("worn:");
  const prompt = useMemo(
    () => buildGeminiPrompt(facts, styles.some((s) => s.id === styleId) ? styleId : "look:cream", { photos: photoCount || 1, skin: worn ? skin || undefined : undefined, extra }),
    [facts, styles, styleId, photoCount, worn, skin, extra]
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked: select the text so Ctrl+C works.
      document.getElementById("gemini-prompt")?.focus();
      (document.getElementById("gemini-prompt") as HTMLTextAreaElement | null)?.select();
    }
  }

  const groups = ["Product shots", "Worn", "Size"] as const;

  return (
    <div className="card pad">
      <h2>Make a picture with Gemini</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: ".85rem" }}>
        Gemini draws a new picture around your real piece. This page only writes the prompt for you: nothing is sent anywhere until you paste it into Gemini.
      </p>
      <ol style={{ margin: "0 0 .8rem", paddingLeft: "1.2rem", fontSize: ".9rem" }}>
        {GEMINI_STEPS.map((s) => <li key={s}>{s}</li>)}
      </ol>

      <div className="fields">
        <div className="wide">
          <label>Picture style</label>
          <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            {groups.map((g) => {
              const list = styles.filter((s) => s.group === g);
              return list.length ? (
                <optgroup key={g} label={g}>
                  {list.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
        {worn && (
          <div>
            <label>Skin tone (optional)</label>
            <select value={skin} onChange={(e) => setSkin(e.target.value)}>
              <option value="">Gemini chooses</option>
              {SKIN_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        )}
        <div className="wide">
          <label>Anything else you want (optional)</label>
          <input value={extra} maxLength={300} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. a few dried flowers beside it, evening light" />
        </div>
        <div className="wide">
          <label>Prompt to paste into Gemini</label>
          <textarea id="gemini-prompt" readOnly value={prompt} style={{ minHeight: "15rem", fontFamily: "ui-monospace, Consolas, monospace", fontSize: ".82rem" }} />
        </div>
      </div>

      <div className="row" style={{ marginTop: ".7rem" }}>
        <button className="btn" onClick={copy}>{copied ? "Copied ✓" : "Copy prompt"}</button>
        <a className="btn ghost" href={GEMINI_URL} target="_blank" rel="noreferrer">Open Gemini ↗</a>
        {photoCount > 0 && <a className="btn ghost" href={`/api/products/${productId}/download?set=originals`}>⬇ Download my {photoCount} photo{photoCount === 1 ? "" : "s"}</a>}
      </div>
      <p className="muted" style={{ fontSize: ".8rem", marginBottom: 0 }}>
        Always compare Gemini&apos;s picture with your real piece before using it: shape, stones, chain and any engraving must match.
      </p>
    </div>
  );
}
