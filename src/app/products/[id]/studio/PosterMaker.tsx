"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sans, serif } from "@/app/fonts";
import {
  FORMATS, THEMES, TEMPLATES, computeTrim, isSale, type Box, type FormatId, type PosterData, type Template, type Theme,
} from "@/lib/posters";
import { claimContext, scanText } from "@/lib/claims";
import { KIND_LABEL, imageUrl, type Product, type ProductImage } from "@/lib/types";

const FONTS = { serif: serif.style.fontFamily, sans: sans.style.fontFamily };

interface Loaded {
  el: HTMLImageElement;
  trim: Box | null;
  isCutout: boolean;
}

function draw(cv: HTMLCanvasElement | null, tpl: Template, W: number, H: number, theme: Theme, data: PosterData, scale = 1) {
  if (!cv) return;
  const c = cv.getContext("2d");
  if (!c) return;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.clearRect(0, 0, W, H);
  tpl.draw(c, W, H, theme, data, FONTS);
}

export default function PosterMaker({
  product, images, onSaved,
}: { product: Product; images: ProductImage[]; onSaved: () => void }) {
  // Cut-outs first: they float on any theme. Then any approved picture (shown in a frame).
  const sources = useMemo(() => {
    const cut = images.filter((i) => i.kind === "cutout" && i.approved);
    const rest = images.filter((i) => i.approved && !["cutout", "poster", "price_card"].includes(i.kind));
    return [...cut, ...rest];
  }, [images]);

  const [sourceId, setSourceId] = useState<number | null>(null);
  const src = sources.find((s) => s.id === sourceId) ?? sources[0];
  const [templateId, setTemplateId] = useState("classic");
  const [formatId, setFormatId] = useState<FormatId>("post");
  const [themeId, setThemeId] = useState("cream");
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(product.price_cad != null ? String(product.price_cad) : "");
  // Compare-at comes only from the product page, where the owner records a price they really charged.
  const compareAt = product.compare_at_cad != null ? String(product.compare_at_cad) : "";
  const [sizes, setSizes] = useState(product.sizes);
  const [footer, setFooter] = useState("DM to order · Vancouver, BC");
  const [headlines, setHeadlines] = useState<Record<string, string>>({});
  const [img, setImg] = useState<Loaded | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const fmt = FORMATS[formatId];
  const headline = headlines[tpl.id] ?? tpl.defaultHeadline;

  // Optional link presets, e.g. /products/3/studio?template=arch&theme=midnight&format=story
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("template"), th = q.get("theme"), f = q.get("format");
    if (t && TEMPLATES.some((x) => x.id === t)) setTemplateId(t);
    if (th && THEMES.some((x) => x.id === th)) setThemeId(th);
    if (f && Object.hasOwn(FORMATS, f)) setFormatId(f as FormatId);
  }, []);

  // Wait for the bundled fonts, or the first drawing would use a fallback font.
  useEffect(() => {
    const loads = [
      `500 40px ${FONTS.serif}`, `600 40px ${FONTS.serif}`, `700 40px ${FONTS.serif}`, `italic 500 40px ${FONTS.serif}`,
      `italic 600 40px ${FONTS.serif}`, `400 20px ${FONTS.sans}`, `500 20px ${FONTS.sans}`, `600 20px ${FONTS.sans}`,
    ].map((f) => document.fonts.load(f));
    Promise.allSettled(loads).then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    if (!src) { setImg(null); return; }
    let cancelled = false;
    const el = new Image();
    el.onload = () => { if (!cancelled) setImg({ el, trim: src.kind === "cutout" ? computeTrim(el) : null, isCutout: src.kind === "cutout" }); };
    el.src = imageUrl(src.path);
    return () => { cancelled = true; };
  }, [src?.id, src?.path, src?.kind, src]);

  const data: PosterData = {
    image: img?.el ?? null, trim: img?.trim ?? null, isCutout: img?.isCutout ?? false,
    name, headline, price, compareAt, sizes, plating: product.plating, footer,
  };

  // Same banned-claims check as the product page: nothing like "solid gold" may go on a poster.
  const posterText = [name, tpl.usesHeadline ? headline : "", price, compareAt, sizes, product.plating, footer].filter(Boolean).join("\n");
  const problems = scanText(posterText, claimContext(product));
  const saleBlocked = tpl.needsSale && !isSale(price, compareAt);

  const main = useRef<HTMLCanvasElement>(null);
  const thumbs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const THUMB = 0.22;
  const deps = [fontsReady, img, tpl, theme, fmt, name, headline, price, compareAt, sizes, footer] as const;

  useEffect(() => {
    if (!fontsReady) return;
    draw(main.current, tpl, fmt.w, fmt.h, theme, data);
    for (const t of TEMPLATES) {
      const h = headlines[t.id] ?? t.defaultHeadline;
      draw(thumbs.current[t.id], t, fmt.w, fmt.h, theme, { ...data, headline: h }, THUMB);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, headlines]);

  const toBlob = () => new Promise<Blob | null>((res) => main.current ? main.current.toBlob(res, "image/png") : res(null));

  async function save() {
    setBusy(true); setMsg("");
    const blob = await toBlob();
    if (!blob) { setBusy(false); return setMsg("Could not render the poster."); }
    const fd = new FormData();
    fd.set("kind", "poster");
    fd.set("label", `${tpl.label} · ${theme.label} · ${fmt.label}`);
    fd.set("text", posterText); // the server checks the same words again
    fd.append("files", blob, "poster.png");
    const r = await fetch(`/api/products/${product.id}/images`, { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) return setMsg((await r.json().catch(() => ({}))).error || "Could not save the poster.");
    setMsg(formatId === "story" ? "Saved ✓ (a Story: post it as a Story, not in the carousel)" : "Saved to your approved library ✓");
    onSaved();
  }

  async function download() {
    const blob = await toBlob();
    if (!blob) return setMsg("Could not render the poster.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${product.sku || "efj"}-${tpl.id}-${theme.id}-${formatId}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const blocked = problems.length > 0 || saleBlocked || !img;

  return (
    <div className="card pad" style={{ marginTop: "1rem" }}>
      {/* Pulls in the bundled font files for the canvas. */}
      <span className={serif.className} style={{ display: "none" }}>a</span>
      <span className={sans.className} style={{ display: "none" }}>a</span>

      <h2>Posters</h2>
      <p className="muted">
        Templates typeset by code (no AI). Your jewellery is your own photo; a <b>transparent cut-out</b> looks best, so
        run “Remove background” first. The words are what you type here (checked for a list of risky phrases, but the wording is still your responsibility); the
        compare-at price comes from the product page.
      </p>

      {!sources.length ? (
        <p className="muted">Run “Remove background” or approve a photo first.</p>
      ) : (
        <>
          <div className="poster-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`poster-thumb ${t.id === tpl.id ? "on" : ""}`}
                onClick={() => setTemplateId(t.id)}
                title={t.hint}
              >
                <canvas
                  ref={(el) => { thumbs.current[t.id] = el; }}
                  width={Math.round(fmt.w * THUMB)}
                  height={Math.round(fmt.h * THUMB)}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="split" style={{ gridTemplateColumns: "minmax(0,380px) 1fr", marginTop: "1rem" }}>
            <canvas
              ref={main}
              width={fmt.w}
              height={fmt.h}
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }}
            />
            <div>
              <p className="muted" style={{ marginTop: 0 }}>{tpl.hint}</p>
              <div className="fields" style={{ alignContent: "start" }}>
                <div><label>Size</label>
                  <select value={formatId} onChange={(e) => setFormatId(e.target.value as FormatId)}>
                    {(Object.keys(FORMATS) as FormatId[]).map((f) => <option key={f} value={f}>{FORMATS[f].label}</option>)}
                  </select></div>
                <div><label>Colours</label>
                  <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                    {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select></div>
                <div className="wide"><label>Picture</label>
                  <select value={src?.id ?? ""} onChange={(e) => setSourceId(Number(e.target.value))}>
                    {sources.map((s) => {
                      const kind = KIND_LABEL[s.kind] ?? s.kind;
                      const extra = s.label && s.label !== kind ? s.label : `#${s.id}`;
                      return <option key={s.id} value={s.id}>{kind} · {extra}</option>;
                    })}
                  </select></div>
                {tpl.usesHeadline && (
                  <div className="wide"><label>Headline</label>
                    <input value={headline} onChange={(e) => setHeadlines((h) => ({ ...h, [tpl.id]: e.target.value }))} /></div>
                )}
                <div className="wide"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><label>Price (CAD, empty to hide)</label><input value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                <div><label>Compare-at (from the product page)</label><input value={compareAt} readOnly disabled placeholder="Not set" />
                  <small className="muted">Only enter a price you really charged for a substantial period recently. This tool only checks it is higher; it cannot check that.</small></div>
                <div className="wide"><label>Sizes (empty to hide)</label><input value={sizes} onChange={(e) => setSizes(e.target.value)} /></div>
                <div className="wide"><label>Footer</label><input value={footer} onChange={(e) => setFooter(e.target.value)} /></div>
              </div>

              {problems.length > 0 && (
                <ul className="q error">{problems.map((p, i) => <li key={i}>Text contains {p}.</li>)}</ul>
              )}
              {saleBlocked && (
                <p className="error">“Special price” needs a compare-at price higher than the price, so it is never a fake discount.</p>
              )}

              <div className="row" style={{ marginTop: ".8rem" }}>
                <button className="btn" onClick={save} disabled={busy || blocked}>{busy ? "Saving…" : "Save to library"}</button>
                <button className="btn ghost" onClick={download} disabled={blocked}>⬇ Download PNG</button>
                {msg && <span className="muted">{msg}</span>}
              </div>
              {!fontsReady && <p className="muted">Loading fonts…</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
