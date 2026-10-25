"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOOKS, LOOK_IDS } from "@/lib/looks";

/** At most this many photos of one piece are rendered automatically. */
const MAX_SOURCES = 6;

interface Existing { file: string; product_id: number; product_name: string; sku: string }

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [render, setRender] = useState(true);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [dup, setDup] = useState<{ message: string; existing: Existing[] } | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (list: FileList | File[]) => {
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imgs]);
    setDup(null);
  };

  async function submit(allowDuplicates = false) {
    setError(""); setDup(null);
    if (!files.length) return setError("Add at least one photo.");
    try {
      setBusy("Uploading photos…");
      const fd = new FormData();
      fd.set("name", name);
      fd.set("category", category);
      if (allowDuplicates) fd.set("allowDuplicates", "1");
      files.forEach((f) => fd.append("files", f));
      const up = await fetch("/api/products", { method: "POST", body: fd });
      const upJson = await up.json();
      if (up.status === 409 && upJson.code === "duplicate_photos") {
        setBusy("");
        return setDup({ message: upJson.error, existing: upJson.existing ?? [] });
      }
      if (!up.ok) throw new Error(upJson.error || "Upload failed");

      const id: number = upJson.id;
      setCreatedId(id);
      if (!render) return router.push(`/products/${id}`);

      // Rendered pictures: each photo is retouched and placed on four drawn backdrops. No AI is used, and nothing on the
      // piece (logos, engravings, stones) is changed.
      const imgs = (await (await fetch(`/api/products/${id}/images`)).json()) as { id: number; kind: string }[];
      const sources = imgs.filter((i) => i.kind === "original").slice(0, MAX_SOURCES);
      const total = sources.length * LOOK_IDS.length;
      let made = 0, n = 0, lastError = "";
      for (const [s, src] of sources.entries()) {
        for (const look of LOOK_IDS) {
          n++;
          setBusy(`Rendering picture ${n} of ${total} (photo ${s + 1}, ${LOOKS[look].label})… the first one of each photo takes the longest`);
          const body = JSON.stringify({ kind: "studio", sourceImageId: src.id, look, format: "post", logo: true });
          const send = () => fetch(`/api/products/${id}/visuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
          let r = await send();
          // A one-off server hiccup (for example while it is still warming up) should not cost a picture: try once more.
          if (!r.ok && r.status >= 500) { await new Promise((res) => setTimeout(res, 2000)); r = await send(); }
          if (r.ok) made++;
          else lastError = (await r.json().catch(() => ({}))).error || `the server answered ${r.status}`;
        }
      }
      if (!made) {
        setBusy("");
        return setError(`Your photos are saved, but nothing could be rendered: ${lastError}`);
      }
      router.push(`/products/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy("");
    }
  }

  return (
    <>
      <h1>Add photos</h1>
      <p className="muted">
        One piece per upload. Add every photo of the same piece together. You get rendered pictures straight away. The AI only runs if
        you press its button on the product page.
      </p>

      <div
        className={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
      >
        <p>Drag photos here, or</p>
        <label className="btn" style={{ color: "#fff", margin: 0 }}>
          Choose photos
          <input
            type="file" accept="image/*" multiple hidden
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
        </label>
        {files.length > 0 && (
          <div className="thumbs">
            {previews.map((src, i) => (
              <div className="t" key={src}>
                <img src={src} alt={`photo ${i + 1}`} />
                <button onClick={() => { setFiles(files.filter((_, j) => j !== i)); setDup(null); }} aria-label="Remove photo">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: ".85rem" }}>
        Best results: a plain background, daylight, no flash, the whole piece in frame. Logos and engravings are kept exactly as photographed.
        JPG or PNG.
      </p>

      <div className="card pad" style={{ marginTop: "1rem" }}>
        <div className="fields">
          <div>
            <label htmlFor="name">Product name (optional)</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="You can set it later" />
          </div>
          <div>
            <label htmlFor="cat">Kind of piece</label>
            <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="other">Not sure</option>
              {["ring", "bracelet", "chain", "necklace", "earring", "anklet", "set"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <label className="chip" style={{ marginTop: "1rem" }}>
        <input type="checkbox" checked={render} onChange={(e) => setRender(e.target.checked)} />
        Render studio pictures from my photos ({LOOK_IDS.map((l) => LOOKS[l].label).join(", ")})
      </label>

      {dup && (
        <div className="notice" style={{ marginTop: "1rem" }}>
          <b>These photos are already in your catalog.</b> {dup.message}
          <ul className="q">
            {[...new Map(dup.existing.map((e) => [e.product_id, e])).values()].map((e) => (
              <li key={e.product_id}>
                <Link href={`/products/${e.product_id}`}>{e.product_name || e.sku} (#{e.product_id})</Link>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn small" onClick={() => submit(true)} disabled={!!busy}>Upload anyway as a new product</button>
            <button className="btn small ghost" onClick={() => { setFiles([]); setDup(null); }}>Clear and start again</button>
          </div>
        </div>
      )}

      {error && (
        <p className="error">
          {error}{" "}
          {createdId && <Link href={`/products/${createdId}`}>Open the product</Link>}
        </p>
      )}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" onClick={() => submit(false)} disabled={!!busy || !files.length}>Upload</button>
        {busy && <span className="muted">{busy}</span>}
      </div>
    </>
  );
}
