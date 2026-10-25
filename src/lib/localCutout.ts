import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * BiRefNet cutout that runs on this computer: no key, no upload, no per-image cost.
 * Model files come from `node scripts/get-birefnet.mjs lite|full` (MIT licence). They live in a per-user folder outside
 * the project, so cloud-sync tools such as OneDrive do not upload them. EFJ_MODEL_DIR moves them.
 * The ONNX runtime is loaded only when a cutout is actually requested. CPU only: on the Intel Arc graphics tested,
 * the DirectML path ran out of memory and then crashed the graphics driver.
 */

export const MODEL_DIR = process.env.EFJ_MODEL_DIR || path.join(os.homedir(), ".efj-studio", "models");
const FILES = {
  lite: "birefnet-lite.onnx",
  "lite-fp16": "birefnet-lite-fp16.onnx",
  full: "birefnet-full-fp16.onnx",
} as const;

const SIZE = 1024; // BiRefNet's working resolution
const MAX_SIDE = 2048; // the cutout keeps up to this many pixels on the long side
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export class LocalCutoutError extends Error {}

/** Path of the model to use, or null when none is installed. BIREFNET_MODEL = lite | lite-fp16 | full | a full path. */
export function localModelPath(): string | null {
  const want = (process.env.BIREFNET_MODEL || "").trim();
  if (want && !(want in FILES)) return fs.existsSync(want) ? want : null;
  const order = want ? [want] : ["lite", "lite-fp16", "full"];
  for (const k of order) {
    const p = path.join(MODEL_DIR, FILES[k as keyof typeof FILES]);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const localCutoutAvailable = () => localModelPath() !== null;

type Ort = typeof import("onnxruntime-node");
interface Loaded { ort: Ort; session: import("onnxruntime-node").InferenceSession; file: string }
const g = globalThis as unknown as { __efjBirefnet?: Promise<Loaded>; __efjBirefnetQueue?: Promise<unknown> };

async function load(file: string): Promise<Loaded> {
  try {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(file, { executionProviders: ["cpu"], logSeverityLevel: 3 });
    return { ort, session, file };
  } catch (e) {
    throw new LocalCutoutError(`The local cutout model could not start: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function session(file: string): Promise<Loaded> {
  if (!g.__efjBirefnet) {
    g.__efjBirefnet = load(file);
    g.__efjBirefnet.catch(() => { g.__efjBirefnet = undefined; }); // allow a retry after a failed start
  }
  return g.__efjBirefnet;
}

/** One cutout at a time: the model is large and a second parallel run only doubles memory use. */
function inQueue<T>(job: () => Promise<T>): Promise<T> {
  const run = (g.__efjBirefnetQueue ?? Promise.resolve()).then(job, job);
  g.__efjBirefnetQueue = run.catch(() => undefined);
  return run;
}

export interface LocalCutoutResult {
  /** PNG with a transparent background and your original pixels. */
  png: Buffer;
  /** Share of the picture kept, 0 to 1. Near 0 or near 1 means the model found nothing useful. */
  coverage: number;
  via: string;
  ms: number;
}

export function localCutout(input: Buffer): Promise<LocalCutoutResult> {
  const file = localModelPath();
  if (!file) throw new LocalCutoutError("No local cutout model is installed. Run: node scripts/get-birefnet.mjs lite");
  return inQueue(async () => {
    const t0 = Date.now();
    const { ort, session: s } = await session(file);

    // Original pixels, upright, no alpha, at most MAX_SIDE on the long side.
    const { data: rgb, info } = await sharp(input)
      .rotate()
      .removeAlpha()
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Model input: 1024x1024, normalised, channels first.
    const small = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(SIZE, SIZE, { fit: "fill" }).raw().toBuffer();
    const plane = SIZE * SIZE;
    const f32 = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) f32[c * plane + i] = (small[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }

    const inName = s.inputNames[0];
    const wantsHalf = String((s.inputMetadata as unknown as { name: string; type?: string }[]).find((m) => m.name === inName)?.type) === "float16";
    let tensor;
    if (wantsHalf) {
      const F16 = (globalThis as unknown as { Float16Array?: new (a: Float32Array) => ArrayBufferView }).Float16Array;
      if (!F16) throw new LocalCutoutError("This model needs half-precision input, which this Node version cannot make. Use the lite model.");
      tensor = new ort.Tensor("float16", new F16(f32) as never, [1, 3, SIZE, SIZE]);
    } else {
      tensor = new ort.Tensor("float32", f32, [1, 3, SIZE, SIZE]);
    }

    const out = await s.run({ [inName]: tensor });
    const logits = out[s.outputNames[s.outputNames.length - 1]].data as ArrayLike<number>;
    if (logits.length !== plane) throw new LocalCutoutError(`The cutout model returned an unexpected shape (${logits.length}).`);

    // Sigmoid to a 0-255 mask, then back up to the photo's size.
    const mask = Buffer.alloc(plane);
    let kept = 0;
    for (let i = 0; i < plane; i++) {
      const v = 1 / (1 + Math.exp(-Number(logits[i])));
      mask[i] = Math.round(v * 255);
      kept += v;
    }
    const alpha = await sharp(mask, { raw: { width: SIZE, height: SIZE, channels: 1 } })
      .resize(width, height, { fit: "fill", kernel: "lanczos3" }) // "fill": undo the squash applied before the model, no cropping
      .extractChannel(0) // make sure it stays ONE channel; a 3-channel buffer here scrambles the transparency
      .raw()
      .toBuffer();
    if (alpha.length !== width * height) throw new LocalCutoutError("The cutout mask came out the wrong size.");
    const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();

    return {
      png,
      coverage: kept / plane,
      via: `local BiRefNet (${path.basename(file)})`,
      ms: Date.now() - t0,
    };
  });
}
