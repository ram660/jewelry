import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, listImages } from "@/lib/db";
import { activeImageModel, imageProvider, safeModeAvailable, visionProvider } from "@/lib/config";
import { FIDELITY_MIN } from "@/lib/visuals";
import StudioClient from "./StudioClient";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <>
      <p><Link href={`/products/${id}`} className="muted">← {product.name || product.sku}</Link></p>
      <StudioClient
        product={product}
        initialImages={listImages(id)}
        demoMode={!imageProvider()}
        scoring={visionProvider() !== null}
        safeAvailable={safeModeAvailable()}
        model={activeImageModel()}
        fidelityMin={FIDELITY_MIN}
      />
    </>
  );
}
