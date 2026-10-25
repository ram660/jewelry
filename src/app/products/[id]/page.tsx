import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, listImages, listMovements } from "@/lib/db";
import { visionProvider } from "@/lib/config";
import ProductEditor from "./ProductEditor";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <>
      <p><Link href="/" className="muted">← Catalog</Link></p>
      {/* Remount only when the AI re-runs; other refreshes (photos, stock) must not wipe unsaved edits. */}
      <ProductEditor
        key={product.analysed_at ?? "new"}
        initial={product}
        images={listImages(id)}
        movements={listMovements(id)}
        demoMode={!visionProvider()}
        nameSuggestions={product.name_suggestions}
      />
    </>
  );
}
