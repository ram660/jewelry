import Link from "next/link";
import { firstImages, listProducts } from "@/lib/db";
import { imageUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string }>;
}) {
  const { q = "", category = "", status = "" } = await searchParams;
  const thumbs = firstImages();
  const all = listProducts();
  const products = all.filter(
    (p) =>
      (!category || p.category === category) &&
      (!status || p.status === status) &&
      (!q || `${p.name} ${p.sku} ${p.subcategory}`.toLowerCase().includes(q.toLowerCase()))
  );

  const stockValue = all.reduce((s, p) => s + (p.cost_cad ?? 0) * p.stock_qty, 0);
  const retailValue = all.reduce((s, p) => s + (p.price_cad ?? 0) * p.stock_qty, 0);

  return (
    <>
      <div className="toolbar">
        <h1 className="grow">Catalog</h1>
        {all.length > 0 && <a href="/api/export" className="btn ghost">⬇ Export CSV</a>}
        <Link href="/upload" className="btn">+ Add product</Link>
      </div>

      <p className="muted">
        {all.length} products · {all.reduce((s, p) => s + p.stock_qty, 0)} pieces in stock · cost value $
        {stockValue.toFixed(0)} · retail value ${retailValue.toFixed(0)} CAD
      </p>

      <form className="toolbar" method="get">
        <input name="q" placeholder="Search name or SKU" defaultValue={q} style={{ maxWidth: 260 }} />
        <select name="category" defaultValue={category} style={{ maxWidth: 160 }}>
          <option value="">All categories</option>
          {["ring", "bracelet", "chain", "necklace", "earring", "anklet", "set", "other"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select name="status" defaultValue={status} style={{ maxWidth: 160 }}>
          <option value="">All statuses</option>
          {["draft", "ready", "scheduled", "posted", "sold_out", "archived"].map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
        <button className="btn ghost" type="submit">Filter</button>
      </form>

      {products.length === 0 ? (
        <div className="card pad">
          {all.length === 0 ? (
            <>No products yet. <Link href="/upload"><b>Upload your first photos</b></Link> to get started.</>
          ) : (
            "Nothing matches that filter."
          )}
        </div>
      ) : (
        <div className="grid">
          {products.map((p) => {
            const img = thumbs.get(p.id);
            return (
              <Link key={p.id} href={`/products/${p.id}`} className="card pcard">
                <div className="ph">
                  {img ? <img src={imageUrl(img.thumb_path)} alt={p.alt_text || p.name} /> : "no photo"}
                </div>
                <div className="meta">
                  <div className="name">{p.name || "(unnamed)"}</div>
                  <div className="sub">
                    <span>{p.sku}</span>
                    <span>{p.price_cad != null ? `$${p.price_cad}` : "no price"}</span>
                  </div>
                  <div className="row" style={{ marginTop: ".4rem" }}>
                    <span className="badge">{p.status.replace("_", " ")}</span>
                    {p.stock_qty === 0 ? (
                      <span className="badge low">out of stock</span>
                    ) : p.stock_qty <= p.low_stock_at ? (
                      <span className="badge warn">low stock · {p.stock_qty}</span>
                    ) : (
                      <span className="badge ok">{p.stock_qty} in stock</span>
                    )}
                    {!p.analysed_at && <span className="badge">not analysed</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
