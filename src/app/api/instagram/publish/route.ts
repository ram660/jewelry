import { NextResponse } from "next/server";
import { z } from "zod";
import { postProblems } from "@/lib/postNotes";
import { publishPost } from "@/lib/providers/instagram";

export const runtime = "nodejs";
export const maxDuration = 300;

const httpsUrl = z.string().url().refine((u) => u.startsWith("https://"), "Instagram needs https image addresses.");

const Body = z.object({
  kind: z.enum(["image", "carousel", "story"]),
  imageUrls: z.array(httpsUrl).min(1).max(10),
  caption: z.string().max(2200).default(""),
  altTexts: z.array(z.string().max(1000)).max(10).default([]),
  /** Only scripts/ig-publish.mts --confirm sends this. */
  confirm: z.literal(true),
});

/** Publishes one post to Instagram. Used by `npm run ig:publish -- <kit> --confirm`, which the owner runs. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Not a valid publish request.", problems: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const b = parsed.data;
  // Checked again here, so nothing reaches Instagram with blanks or banned wording even if the script is bypassed.
  const problems = b.kind === "story" ? [] : postProblems(b.caption, b.altTexts);
  if (problems.length) return NextResponse.json({ error: "Fix the text first.", problems }, { status: 400 });
  const result = await publishPost(b);
  return NextResponse.json(result, { status: result.ok ? 200 : result.unknown ? 504 : 502 });
}
