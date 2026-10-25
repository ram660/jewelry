"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LOOKS, LOOK_IDS } from "@/lib/looks";
import { KIND_LABEL, imageUrl, type ProductImage } from "@/lib/types";

/** At most this many of the owner's photos are rendered automatically. */
const MAX_SOURCES = 6;

const ORDER: Record<string, number> = { studio: 0, scene: 1, on_model: 2, clean: 3, enhanced: 4, poster: 5, price_card: 6, scale: 7, cutout: 8 };

/**
 * The rendered pictures of this product: your own photo retouched and placed on a drawn backdrop. Nothing here is made by
 * AI, nothing on the piece is changed, and every mark and engraving is kept as photographed.
 */
export default function RenderedGallery({ productId, images }: { productId: number; images: ProductImage[] }) {
  const router = useRouter();
  const [logo, setLogo] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const originals = images.filter((i) => i.kind === "original");
  const rendered = images
    .filter((i) => i.kind !== "original")
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || a.id - b.id);

  const hasLook = (srcId: number, look: (typeof LOOK_IDS)[number]) =>
    images.some((i) => i.kind === "studio" && i.source_image_id === srcId && (i.label ?? "").startsWith(LOOKS[look].label));

  async function render() {
    setError(""); setNote("");
    const jobs = originals.slice(0, MAX_SOURCES).flatMap((src) => LOOK_IDS.filter((look) => !hasLook(src.id, look)).map((look) => ({ src, look })));
    if (!jobs.length) return setNote("Everything is already rendered. Add another photo to render more.");
    let made = 0, last = "";
    for (const [n, j] of jobs.entries()) {
      setProgress(`Rendering ${n + 1} of ${jobs.length}: ${LOOKS[j.look].label}… the first picture of each photo takes longest`);
      const body = JSON.stringify({ kind: "studio", sourceImageId: j.src.id, look: j.look, format: "post", logo });
      const send = () => fetch(`/api/products/${productId}/visuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      let r = await send();
      // A one-off server hiccup (for example while it is still warming up) should not cost a picture: try once more.
      if (!r.ok && r.status >= 500) { await new Promise((res) => setTimeout(res, 2000)); r = await send(); }
      if (r.ok) { made++; if (made % 4 === 0) router.refresh(); }
      else last = (await r.json().catch(() => ({}))).error || `the server answered ${r.status}`;
    }
    setProgress("");
    router.refresh();
    if (!made) setError(`Nothing could be rendered: ${last}`);
    else if (last) setNote(`${made} of ${jobs.length} rendered. One failed: ${last}`);
  }

  return (
    <div className="card pad">
      <div className="toolbar" style={{ marginBottom: ".6rem" }}>
        <h2 className="grow" style={{ margin: 0 }}>Rendered images</h2>
        {rendered.length > 0 && <a className="btn ghost small" href={`/api/products/${productId}/download?set=rendered`}>⬇ Download all (ZIP)</a>}
        <button className="btn small" onClick={render} disabled={!!progress || !originals.length}>
          {rendered.length ? "Render missing looks" : "Render images"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: ".85rem" }}>
        Your own photo, retouched and placed on a clean backdrop. No AI makes or changes anything here, so every logo, engraving and
        stone stays exactly as you photographed it.
      </p>
      <label className="chip" style={{ marginBottom: ".6rem" }}>
        <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> Add our logo to new renders
      </label>

      {progress && <p className="muted">{progress}</p>}
      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}

      {rendered.length === 0 && !progress ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          {originals.length ? "Nothing rendered yet. Press “Render images” to make studio pictures from your photos." : "Add a photo first."}
        </p>
      ) : (
        <div className="tiles">
          {rendered.map((im) => (
            <div className="tile" key={im.id}>
              <a className="pic" href={imageUrl(im.path)} target="_blank" rel="noreferrer">
                <img src={imageUrl(im.thumb_path)} alt={im.label ?? KIND_LABEL[im.kind] ?? im.kind} />
              </a>
              <div style={{ fontSize: ".82rem", margin: ".4rem 0 .3rem" }}>{im.label ?? KIND_LABEL[im.kind] ?? im.kind}</div>
              <a className="btn small ghost" href={imageUrl(im.path)} download={`product-${productId}-${im.id}${im.path.endsWith(".png") ? ".png" : ".jpg"}`}>
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
