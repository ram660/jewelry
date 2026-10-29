import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_PHOTOS, MAX_PHOTO_BYTES } from "@/lib/storage";
import { kitDir, listKits, listTracks, slugify, writeMeta, audioDir } from "@/lib/kits";
import { startKit } from "@/lib/kitJobs";
import { ffmpegPath } from "@/lib/reel";
import { localCutoutAvailable } from "@/lib/localCutout";
import { claudeConfigured, geminiConfigured, igTokenConfigured, visionProvider } from "@/lib/config";

export const runtime = "nodejs";

/** The kits, plus what this computer can do (cutout model, ffmpeg, music tracks, Instagram token). */
export async function GET() {
  return NextResponse.json({
    kits: listKits(),
    cutout: localCutoutAvailable(),
    ai: visionProvider(),
    claude: claudeConfigured(),
    gemini: geminiConfigured(),
    ffmpeg: Boolean(ffmpegPath()),
    tracks: listTracks(),
    audioDir: audioDir(),
    instagram: igTokenConfigured(),
  });
}

const Meta = z.object({
  name: z.string().trim().min(2, "Give the product a name.").max(60),
});

/** Saves the uploaded photos into a new kit folder and starts making the kit. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The photos didn't arrive in full. Try fewer photos at a time." }, { status: 400 });
  const meta = Meta.safeParse({ name: form.get("name") });
  if (!meta.success) return NextResponse.json({ error: meta.error.issues[0].message }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Add at least one photo." }, { status: 400 });
  if (files.length > MAX_PHOTOS) return NextResponse.json({ error: `At most ${MAX_PHOTOS} photos at a time.` }, { status: 400 });
  if (files.some((f) => f.size > MAX_PHOTO_BYTES)) return NextResponse.json({ error: "Each photo must be under 25 MB." }, { status: 400 });

  const slug = slugify(meta.data.name);
  const dir = slug ? kitDir(slug) : null;
  if (!dir) return NextResponse.json({ error: "Use letters or numbers in the name." }, { status: 400 });
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    return NextResponse.json({ error: `There is already a kit called "${slug}". Open it from the list, or use another name.`, slug }, { status: 409 });
  }

  // Upright JPEGs under plain names. The same photo twice is kept once.
  const source = path.join(dir, ".source");
  const seen = new Set<string>();
  let duplicates = 0, saved = 0;
  const unreadable: string[] = [];
  fs.mkdirSync(source, { recursive: true });
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const hash = createHash("sha256").update(buf).digest("hex");
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    try {
      const jpg = await sharp(buf).rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer();
      fs.writeFileSync(path.join(source, `photo-${String(++saved).padStart(2, "0")}.jpg`), jpg);
    } catch {
      unreadable.push(f.name || "a photo");
    }
  }
  if (!saved) {
    fs.rmSync(dir, { recursive: true, force: true });
    return NextResponse.json({ error: "None of the photos could be read. HEIC can't be used: export them as JPG." }, { status: 400 });
  }
  // Type and tone are read from the photos by the AI, and the owner can correct them on the review page.
  writeMeta(slug, { name: meta.data.name, category: "other", finish: "gold", price: "" });
  const started = startKit(slug, { dropDark: false, name: meta.data.name });
  if ("error" in started) return NextResponse.json({ error: started.error, slug }, { status: started.status });
  return NextResponse.json({ slug, jobId: started.job.id, photos: saved, duplicates, unreadable });
}
