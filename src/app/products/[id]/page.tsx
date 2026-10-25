import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, listImages, listMovements } from "@/lib/db";
import { visionProvider } from "@/lib/config";
import ProductEditor from "./ProductEditor";
import RenderedGallery from "./RenderedGallery";
import GeminiPrompt from "./GeminiPrompt";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) notFound();
  const images = listImages(id);
  const photoCount = images.filter((i) => i.kind === "original").length;

  return (
    <>
      <p><Link href="/" className="muted">← Catalog</Link></p>
      {/* Remount only when the AI re-runs; other refreshes (photos, stock) must not wipe unsaved edits. */}
      <ProductEditor
        key={product.analysed_at ?? "new"}
        initial={product}
        images={images}
        movements={listMovements(id)}
        demoMode={!visionProvider()}
        nameSuggestions={product.name_suggestions}
        topSlot={
          <>
            <RenderedGallery productId={id} images={images} />
            <GeminiPrompt
              productId={id}
              photoCount={photoCount}
              facts={{
                category: product.category,
                gender: product.gender,
                colour_finish: product.colour_finish,
                stones: product.stones,
                marks_seen: product.marks_seen,
              }}
            />
          </>
        }
      />
    </>
  );
}
