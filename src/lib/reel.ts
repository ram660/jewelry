import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { findTool } from "./tools";
import { kitDir, kitFiles, reelName, trackFile } from "./kits";
import { slideFiles, type Draft } from "./kitDraft";
import { priceCard, recipeLabel, type RecipeId } from "./reelRecipes";

/**
 * A short Reel (1080x1920, about 8 to 15 s) from a kit's own images, with the owner's music track mixed in (or silent when
 * muted). Instagram's API can't add songs from Instagram's music library, so a post only has sound when the video already
 * contains it. The images are used as they are: each one gets a camera move and a transition, and nothing on the
 * jewellery changes. The style ("recipe") decides the moves, transitions and timing (see lib/reelRecipes.ts).
 * Server-only (Node, ffmpeg).
 */

export const ffmpegPath = () => findTool("ffmpeg", "Gyan.FFmpeg");

const W = 1080, H = 1920, FPS = 30;
const MAX_FRAMES = 4;
const MIN_SECONDS = 8;

/** A 4:5 photo on a 9:16 frame: the photo itself in the middle, over a soft blurred copy of it. */
async function toFrame(src: string, out: string) {
  // From memory, not by path: on Windows sharp would keep the kit's image locked, and it couldn't be made again.
  const file = fs.readFileSync(src);
  const m = await sharp(file).metadata();
  if (m.width === W && m.height === H) return void fs.writeFileSync(out, file);
  const bg = await sharp(file).resize(W, H, { fit: "cover" }).blur(40).modulate({ brightness: 0.9 }).toBuffer();
  const fg = await sharp(file).resize({ width: W, height: H, fit: "inside" }).toBuffer();
  const fm = await sharp(fg).metadata();
  await sharp(bg)
    .composite([{ input: fg, left: Math.round((W - fm.width!) / 2), top: Math.round((H - fm.height!) / 2) }])
    .jpeg({ quality: 94 })
    .toFile(out);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Breaks the order line into short lines for the card. */
function wrap(text: string, max = 26): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= max) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines.slice(0, 4);
}

/** The closing card: the price and how to order, as plain text over a soft, darkened copy of a kit image. */
async function cardFrame(bgSrc: string, card: { price: string; order: string }, out: string) {
  const bg = await sharp(fs.readFileSync(bgSrc)).resize(W, H, { fit: "cover" }).blur(30).modulate({ brightness: 0.55 }).toBuffer();
  const order = wrap(card.order);
  const top = 860 - order.length * 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="${W / 2}" y="${top}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="150" fill="#fffaf0">${xml(card.price)}</text>
  <line x1="${W / 2 - 120}" x2="${W / 2 + 120}" y1="${top + 70}" y2="${top + 70}" stroke="#e8d3a2" stroke-width="3"/>
  ${order.map((l, i) => `<text x="${W / 2}" y="${top + 160 + i * 66}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="50" fill="#fffaf0">${xml(l)}</text>`).join("\n  ")}
</svg>`;
  await sharp(bg).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 94 }).toFile(out);
}

/** How the camera moves over one frame, as a zoompan filter on a frame shown for `frames` frames. */
type Move = "in" | "out" | "pull" | "pan" | "still";
const MOVES: Record<Move, (frames: number) => string> = {
  in: () => `z='min(1+0.0009*in,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  out: () => `z='max(1.12-0.0009*in,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  pull: (f) => `z='max(1.6-${(0.6 / f).toFixed(5)}*in,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  pan: (f) => `z=1.22:x='(iw-iw/zoom)*min(in/${f},1)':y='ih/2-(ih/zoom/2)'`,
  still: () => `z=1:x=0:y=0`,
};

interface Plan {
  frames: { src: string; move: Move; card?: { price: string; order: string } }[];
  show: number;
  fade: number;
  transition: string;
}

/** Which frames each style uses, in what order, with which moves and transitions. */
function planFor(recipe: RecipeId, picks: string[], closeup: string | undefined, end: string | undefined, card: { price: string; order: string } | null): Plan {
  const body = picks.slice(0, MAX_FRAMES - (end ? 1 : 0));
  const withEnd = (f: Plan["frames"]) => (end ? [...f, { src: end, move: "in" as Move }] : f);
  switch (recipe) {
    case "quick": {
      // Short beats with a white flash on each cut: the pictures go round twice.
      const all = [...body, ...(end ? [end] : [])];
      const frames: Plan["frames"] = [];
      for (let i = 0; frames.length < 6; i++) frames.push({ src: all[i % all.length], move: i % 2 ? "out" : "in" });
      return { frames, show: 1.6, fade: 0.25, transition: "fadewhite" };
    }
    case "push":
      return { frames: withEnd(body.map((src) => ({ src, move: "out" as Move }))), show: 2.8, fade: 0.5, transition: "slideleft" };
    case "reveal": {
      // Starts tight on the close-up and pulls out; then the full piece.
      const first = closeup ?? body[0];
      const rest = body.filter((s) => s !== first);
      return { frames: withEnd([{ src: first, move: "pull" }, ...rest.map((src) => ({ src, move: "in" as Move }))]), show: 3, fade: 0.6, transition: "vertopen" };
    }
    case "kenburns": {
      const first = closeup ?? body[0];
      const rest = body.filter((s) => s !== first).slice(0, 1);
      const frames: Plan["frames"] = [{ src: first, move: "pan" }, ...rest.map((src) => ({ src, move: "in" as Move }))];
      // Ends on the price card when there is one; otherwise on the Story image like the others.
      if (card) frames.push({ src: end ?? first, move: "still", card });
      else if (end) frames.push({ src: end, move: "in" });
      return { frames, show: 3.4, fade: 0.7, transition: "dissolve" };
    }
    default:
      return { frames: withEnd(body.map((src) => ({ src, move: "in" as Move }))), show: 3.2, fade: 0.6, transition: "fade" };
  }
}

export interface ReelInput {
  slug: string;
  /** 4:5 slide file names in order; the Story image is added at the end. */
  slides: string[];
  /** A file in the audio folder, or null for a Reel without music. */
  track: string | null;
  /** The Story image to end on (studio or the owner's own, whichever the post uses). */
  story?: string | null;
  /** The style. The plain slow zoom when not given. */
  recipe?: RecipeId;
  /** The page's price and order line, for the price card. */
  fields?: Draft["fields"];
  /** File name to write in the kit folder (default: the kit's Reel). */
  out?: string;
}

export async function buildReel({ slug, slides, track, story, recipe = "zoom", fields, out }: ReelInput, log: (line: string) => void): Promise<string> {
  const exe = ffmpegPath();
  if (!exe) throw new Error("ffmpeg isn't installed, so the Reel can't be made. Install it with: winget install Gyan.FFmpeg");
  const dir = kitDir(slug);
  if (!dir) throw new Error("Unknown kit.");
  const audio = track === null ? null : trackFile(track);
  if (track !== null && !audio) throw new Error("Pick a music track first (MP3s in the audio folder).");
  const files = kitFiles(slug);
  const known = new Set(slideFiles(files));
  const end = story && [...files.story, ...files.originalStory, ...files.claudeStory].includes(story) ? story : files.story[0];
  const picks = slides.filter((s) => known.has(s));
  if (!picks.length && files.main[0]) picks.push(files.main[0]);
  if (!picks.length && !end) throw new Error("This kit has no images to make a Reel from.");
  if (!picks.length && end) picks.push(end);
  const closeup = picks.find((s) => /closeup/.test(s)) ?? files.closeup[0];
  const card = recipe === "kenburns" && fields ? priceCard(fields) : null;
  if (recipe === "kenburns" && !card) log("No price card: the price isn't filled in (or its text didn't pass the wording check).");
  const plan = planFor(recipe, picks, closeup && known.has(closeup) ? closeup : undefined, end ?? undefined, card);

  const n = plan.frames.length;
  // Never shorter than about 8 s: with few pictures each one stays on longer.
  const show = Math.max(plan.show, +((MIN_SECONDS + (n - 1) * plan.fade) / n).toFixed(2));
  const total = +(n * show - (n - 1) * plan.fade).toFixed(2);
  const stepFrames = Math.round(show * FPS);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "efj-reel-"));
  try {
    log(`Preparing ${n} frame(s)…`);
    const frames: string[] = [];
    for (const [i, f] of plan.frames.entries()) {
      const o = path.join(tmp, `f${i}.jpg`);
      if (f.card) await cardFrame(path.join(dir, f.src), f.card, o);
      else await toFrame(path.join(dir, f.src), o);
      frames.push(o);
    }
    const args: string[] = ["-hide_banner", "-y"];
    for (const f of frames) args.push("-loop", "1", "-framerate", String(FPS), "-t", String(show), "-i", f);
    if (audio) args.push("-stream_loop", "-1", "-i", audio);
    else args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo");
    const filters: string[] = [];
    // Upscaled first so the slow moves don't wobble.
    plan.frames.forEach((f, i) =>
      filters.push(
        `[${i}:v]scale=${W * 2}:${H * 2},zoompan=${MOVES[f.move](stepFrames)}:d=1:s=${W}x${H}:fps=${FPS},setsar=1,scale=w=iw:h=ih:out_range=tv,format=yuv420p[v${i}]`
      )
    );
    let last = "v0";
    for (let i = 1; i < n; i++) {
      filters.push(`[${last}][v${i}]xfade=transition=${plan.transition}:duration=${plan.fade}:offset=${(i * (show - plan.fade)).toFixed(2)}[x${i}]`);
      last = `x${i}`;
    }
    // Standard video range (yuv420p, not the JPEG full range the photos come in), which is what Instagram expects.
    filters.push(`[${last}]format=yuv420p[vout]`);
    filters.push(
      audio
        ? `[${n}:a]atrim=0:${total},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, total - 1.5)}:d=1.5[a]`
        : `[${n}:a]atrim=0:${total},asetpts=PTS-STARTPTS[a]`
    );
    const tmpOut = path.join(tmp, "reel.mp4");
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[vout]", "-map", "[a]",
      "-t", String(total), "-r", String(FPS),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-color_range", "tv", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-movflags", "+faststart",
      tmpOut
    );
    log(`Making a ${total} s Reel. Style: ${recipeLabel(recipe)}, track: ${track ?? "none (muted)"}…`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let tail = "";
      let lastPct = -10;
      p.stderr!.on("data", (d: Buffer) => {
        tail = (tail + String(d)).slice(-2000);
        const t = String(d).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (t) {
          const pct = Math.min(100, Math.round(((+t[1] * 3600 + +t[2] * 60 + +t[3]) / total) * 100));
          if (pct >= lastPct + 10) log(`Encoding… ${(lastPct = pct)}%`);
        }
      });
      p.once("error", (e) => reject(new Error(`Could not run ffmpeg (${e.message}).`)));
      p.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (exit ${code}): ${tail.split("\n").filter(Boolean).slice(-3).join(" ")}`))));
    });
    const name = out ?? reelName(slug);
    fs.copyFileSync(tmpOut, path.join(dir, name));
    log("Reel ready.");
    return name;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
