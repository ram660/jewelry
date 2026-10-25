"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOOKS, LOOK_IDS } from "@/lib/looks";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [autoStudio, setAutoStudio] = useState(true);
  const [createdId, setCreatedId] = useState<number | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (list: FileList | File[]) => {
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imgs]);
  };

  async function submit() {
    setError("");
    if (!files.length) return setError("Add at least one photo.");
    try {
      setBusy("Uploading photos…");
      const fd = new FormData();
      fd.set("name", name);
      fd.set("category", category);
      files.forEach((f) => fd.append("files", f));
      const up = await fetch("/api/products", { method: "POST", body: fd });
      const upJson = await up.json();
      if (!up.ok) throw new Error(upJson.error || "Upload failed");

      const id: number = upJson.id;
      setCreatedId(id);

      setBusy("Writing the details and captions…");
      const an = await fetch(`/api/products/${id}/analyze`, { method: "POST" });
      if (!an.ok) {
        const j = await an.json().catch(() => ({}));
        // The product exists; open it so the owner can retry the analysis from the editor.
        setError(j.error || "AI analysis failed. You can retry from the product page.");
        router.push(`/products/${id}`);
        return;
      }

      if (!autoStudio) return router.push(`/products/${id}`);

      // Post-ready studio shots retouched from the main photo (no generated pixels): one per look, Instagram post size, with the logo.
      const imgs = await (await fetch(`/api/products/${id}/images`)).json();
      const main = imgs.find((i: { kind: string }) => i.kind === "original");
      let made = 0, lastError = "";
      for (const [n, look] of LOOK_IDS.entries()) {
        setBusy(`Making studio shot ${n + 1} of ${LOOK_IDS.length}: ${LOOKS[look].label}…`);
        const r = await fetch(`/api/products/${id}/visuals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "studio", sourceImageId: main.id, look, format: "post", logo: true }),
        });
        if (r.ok) made++;
        else lastError = (await r.json().catch(() => ({}))).error || "unknown error";
      }
      if (!made) {
        setBusy("");
        setError(`The product is saved, but studio shots couldn't be made from this photo: ${lastError}`);
        return;
      }
      router.push(`/products/${id}/studio`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy("");
    }
  }

  return (
    <>
      <h1>Add a product</h1>
      <p className="muted">One piece per upload. Add several photos of the same piece for better results.</p>

      <div className="card pad">
        <b>Shot checklist:</b> front · side · close-up of details/stones · clasp or back · scale (on hand, or next
        to a coin). Daylight, no flash, plain background, same setup every time. JPG or PNG.
      </div>

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
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove photo">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card pad" style={{ marginTop: "1rem" }}>
        <div className="fields">
          <div>
            <label htmlFor="name">Product name (optional, AI will suggest one)</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aria Stacking Ring" />
          </div>
          <div>
            <label htmlFor="cat">Category</label>
            <select id="cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="other">Let AI decide</option>
              {["ring", "bracelet", "chain", "necklace", "earring", "anklet", "set"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <label className="chip" style={{ marginTop: "1rem" }}>
        <input type="checkbox" checked={autoStudio} onChange={(e) => setAutoStudio(e.target.checked)} />
        Also make post-ready studio shots, retouched from the main photo with no generated pixels ({LOOK_IDS.map((l) => LOOKS[l].label).join(", ")}). Colour and shine are enhanced, so check them against the piece.
      </label>

      {error && (
        <p className="error">
          {error}{" "}
          {createdId && <Link href={`/products/${createdId}`}>Open the product</Link>}
        </p>
      )}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" onClick={submit} disabled={!!busy}>Upload &amp; analyse</button>
        {busy && <span className="muted">{busy}</span>}
      </div>
    </>
  );
}
