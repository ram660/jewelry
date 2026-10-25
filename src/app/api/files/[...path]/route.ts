import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { safeResolve } from "@/lib/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const full = safeResolve(rel);
  if (!full) return new NextResponse("Bad path", { status: 400 });
  try {
    const buf = await fs.readFile(full);
    const ext = full.slice(full.lastIndexOf("."));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
