import { NextResponse } from "next/server";
import { Draft } from "@/lib/kitDraft";
import { hasSource, kitDir, kitFiles, makeOriginals, readKit, saveDraft } from "@/lib/kits";
import { runningJob } from "@/lib/jobs";
import { readStyleState } from "@/lib/claudeStyle";
import { readRecommendations } from "@/lib/recommendations";
import { readReels } from "@/lib/reelVariants";
import { fidelityMin, readAiScenes } from "@/lib/aiScene";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  // Kits made before "My original photos" existed get their framed originals the first time they are opened.
  if (kitDir(slug) && hasSource(slug) && !kitFiles(slug).original.length && kitFiles(slug).main.length) await makeOriginals(slug).catch(() => {});
  const kit = readKit(slug);
  if (!kit) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const jobs = Object.fromEntries((["kit", "regen", "reel", "publish", "ai"] as const).map((k) => [k, runningJob(slug, k)?.id ?? null]));
  // Market research written outside the Studio: checked line by line before the page sees it.
  let raw: unknown = null, unreadable = false;
  try { raw = JSON.parse(fs.readFileSync(path.join(kitDir(slug)!, "recommendations.json"), "utf8")); } catch (e) { unreadable = (e as NodeJS.ErrnoException).code !== "ENOENT"; }
  const recommendations = unreadable ? { status: "invalid" as const } : readRecommendations(raw);
  return NextResponse.json({ ...kit, jobs, claudeStyle: readStyleState(slug), recommendations, reels: readReels(slug), aiScenes: readAiScenes(slug), fidelityMin: fidelityMin() });
}

/** Saves the page's draft (caption, slides, alt text, fields), so it survives a reload. */
export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!kitDir(slug) || !readKit(slug)) return NextResponse.json({ error: "No such kit." }, { status: 404 });
  const parsed = Draft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Not a valid draft.", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  saveDraft(slug, parsed.data);
  return NextResponse.json({ ok: true });
}
