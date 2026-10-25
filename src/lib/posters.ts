/**
 * Instagram poster templates, drawn with the browser's canvas. Nothing here is AI: the jewellery is your own photo
 * (ideally a transparent cut-out) and every letter is typeset by code, so prices and claims are exactly what you typed.
 */

export type FormatId = "post" | "square" | "story";

export const FORMATS: Record<FormatId, { label: string; w: number; h: number }> = {
  post: { label: "Post 4:5", w: 1080, h: 1350 },
  square: { label: "Square 1:1", w: 1080, h: 1080 },
  story: { label: "Story 9:16", w: 1080, h: 1920 },
};

export interface Theme {
  id: string;
  label: string;
  bg: string;
  bg2: string;
  panel: string;
  ink: string;
  muted: string;
  accent: string;
  line: string;
}

export const THEMES: Theme[] = [
  { id: "cream", label: "Cream", bg: "#faf6ee", bg2: "#ede3d2", panel: "#fffdf8", ink: "#2a2622", muted: "#8a8279", accent: "#a8823a", line: "#dccdae" },
  { id: "blush", label: "Blush", bg: "#f8ece7", bg2: "#ecd5cc", panel: "#fff9f6", ink: "#3a2a28", muted: "#957a74", accent: "#a8704f", line: "#e3c3b6" },
  { id: "sage", label: "Sage", bg: "#edf0e8", bg2: "#d5ddcd", panel: "#f9fbf6", ink: "#26302a", muted: "#6f7c71", accent: "#8f7234", line: "#c4cfbd" },
  { id: "midnight", label: "Midnight", bg: "#22212a", bg2: "#14131a", panel: "#2c2a35", ink: "#f4ece0", muted: "#b3a99b", accent: "#d9b56a", line: "#4a4552" },
  { id: "festive-red", label: "Festive red", bg: "#801f1d", bg2: "#5a1312", panel: "#8f2a27", ink: "#fbefd9", muted: "#ecc9a2", accent: "#f2c76b", line: "#a8433c" },
  { id: "marigold", label: "Marigold", bg: "#f7e3b6", bg2: "#ebc47e", panel: "#fcf2da", ink: "#3b2a12", muted: "#7d6440", accent: "#93520f", line: "#e2b867" },
];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PosterData {
  image: HTMLImageElement | null;
  /** Bounds of the visible part of a transparent cut-out, in image pixels. */
  trim: Box | null;
  isCutout: boolean;
  name: string;
  headline: string;
  price: string;
  compareAt: string;
  sizes: string;
  plating: string;
  footer: string;
}

export interface Fonts {
  serif: string;
  sans: string;
}

type Ctx = CanvasRenderingContext2D;

export interface Template {
  id: string;
  label: string;
  hint: string;
  defaultHeadline: string;
  usesHeadline: boolean;
  needsSale?: boolean;
  draw(c: Ctx, W: number, H: number, t: Theme, d: PosterData, f: Fonts): void;
}

export const BRAND = "ELEGANT FASHION JEWELLERY";

// ---------------------------------------------------------------- helpers

const num = (s: string) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
export const money = (s: string) => {
  const n = num(s);
  if (n == null) return "";
  return `$${Number.isInteger(n) ? n : n.toFixed(2)} CAD`;
};
export const isSale = (price: string, compareAt: string) => {
  const p = num(price), c = num(compareAt);
  return p != null && c != null && c > p;
};

function setSpacing(c: Ctx, px: number) {
  (c as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function setFont(c: Ctx, weight: number, size: number, family: string, italic = false) {
  c.font = `${italic ? "italic " : ""}${weight} ${Math.round(size)}px ${family}`;
}

interface TextOpts {
  size: number;
  family: string;
  color: string;
  weight?: number;
  italic?: boolean;
  align?: CanvasTextAlign;
  spacing?: number;
  maxW?: number;
  minSize?: number;
}

/** Draws one line of text, shrinking it to fit maxW. */
function text(c: Ctx, s: string, x: number, y: number, o: TextOpts) {
  if (!s) return;
  const weight = o.weight ?? 500;
  let size = o.size;
  setSpacing(c, o.spacing ?? 0);
  setFont(c, weight, size, o.family, o.italic);
  if (o.maxW) {
    const min = o.minSize ?? o.size * 0.5;
    while (c.measureText(s).width > o.maxW && size > min) {
      size -= 2;
      setFont(c, weight, size, o.family, o.italic);
    }
  }
  c.fillStyle = o.color;
  c.textAlign = o.align ?? "center";
  c.textBaseline = "alphabetic";
  c.fillText(s, x, y);
  setSpacing(c, 0);
}

function fillBackground(c: Ctx, W: number, H: number, t: Theme) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.bg);
  g.addColorStop(1, t.bg2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

function roundRectPath(c: Ctx, b: Box, r: number) {
  c.beginPath();
  c.roundRect(b.x, b.y, b.w, b.h, r);
}

function archPath(c: Ctx, b: Box) {
  const r = b.w / 2;
  c.beginPath();
  c.moveTo(b.x, b.y + b.h);
  c.lineTo(b.x, b.y + r);
  c.arc(b.x + r, b.y + r, r, Math.PI, 0);
  c.lineTo(b.x + b.w, b.y + b.h);
  c.closePath();
}

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 2) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

/**
 * Draws the product into a box. A transparent cut-out floats on the poster with a soft shadow; an ordinary photo is
 * cropped to fill a frame (rounded rectangle or arch) so its own background stays tidy.
 */
function drawProduct(c: Ctx, d: PosterData, box: Box, t: Theme, frame: "rounded" | "arch" = "rounded", shadow = true) {
  const img = d.image;
  if (!img) {
    c.save();
    c.setLineDash([14, 10]);
    c.strokeStyle = t.line;
    c.lineWidth = 3;
    roundRectPath(c, box, 24);
    c.stroke();
    c.restore();
    return;
  }
  if (d.isCutout) {
    const src = d.trim ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const s = Math.min(box.w / src.w, box.h / src.h);
    const dw = src.w * s, dh = src.h * s;
    c.save();
    if (shadow) {
      c.shadowColor = "rgba(0,0,0,0.22)";
      c.shadowBlur = box.w * 0.045;
      c.shadowOffsetY = box.w * 0.02;
    }
    c.drawImage(img, src.x, src.y, src.w, src.h, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    c.restore();
    return;
  }
  c.save();
  if (frame === "arch") archPath(c, box);
  else roundRectPath(c, box, box.w * 0.035);
  c.clip();
  const s = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  c.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  c.restore();
  c.save();
  if (frame === "arch") archPath(c, box);
  else roundRectPath(c, box, box.w * 0.035);
  c.strokeStyle = t.line;
  c.lineWidth = 3;
  c.stroke();
  c.restore();
}

const inset = (b: Box, p: number): Box => ({ x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: b.h - 2 * p });

// ---------------------------------------------------------------- templates

export const TEMPLATES: Template[] = [
  {
    id: "classic",
    label: "Info card",
    hint: "Photo, name, “10K gold-plated”, price and sizes. The workhorse slide.",
    defaultHeadline: "",
    usesHeadline: false,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      fillBackground(c, W, H, t);
      text(c, BRAND, W / 2, H * 0.065, { size: 22 * k, weight: 600, family: f.sans, color: t.accent, spacing: 6 * k });
      const panel = { x: W * 0.08, y: H * 0.095, w: W * 0.84, h: H * 0.56 };
      c.fillStyle = t.panel;
      roundRectPath(c, panel, 32 * k);
      c.fill();
      c.strokeStyle = t.line;
      c.lineWidth = 2;
      c.stroke();
      drawProduct(c, d, inset(panel, d.isCutout ? panel.w * 0.07 : 0), t);
      text(c, d.name, W / 2, H * 0.735, { size: 68 * k, weight: 600, family: f.serif, color: t.ink, maxW: W * 0.84 });
      text(c, d.plating.toUpperCase(), W / 2, H * 0.775, { size: 24 * k, weight: 500, family: f.sans, color: t.muted, spacing: 4 * k });
      text(c, money(d.price), W / 2, H * 0.855, { size: 74 * k, weight: 600, family: f.serif, color: t.accent });
      if (d.sizes) text(c, `Sizes: ${d.sizes}`, W / 2, H * 0.897, { size: 26 * k, family: f.sans, color: t.ink, maxW: W * 0.84 });
      line(c, W * 0.38, H * 0.922, W * 0.62, H * 0.922, t.line);
      text(c, d.footer, W / 2, H * 0.955, { size: 22 * k, family: f.sans, color: t.muted, spacing: 2 * k, maxW: W * 0.84 });
    },
  },
  {
    id: "arch",
    label: "Arch",
    hint: "The piece framed in an arch. Calm and premium; great as a first slide.",
    defaultHeadline: "Everyday elegance",
    usesHeadline: true,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      fillBackground(c, W, H, t);
      text(c, BRAND, W / 2, H * 0.06, { size: 20 * k, weight: 600, family: f.sans, color: t.accent, spacing: 6 * k });
      text(c, d.headline, W / 2, H * 0.112, { size: 46 * k, weight: 500, italic: true, family: f.serif, color: t.muted, maxW: W * 0.8 });
      const arch = { x: W * 0.16, y: H * 0.14, w: W * 0.68, h: H * 0.6 };
      c.fillStyle = t.panel;
      archPath(c, arch);
      c.fill();
      c.strokeStyle = t.line;
      c.lineWidth = 2;
      c.stroke();
      drawProduct(c, d, d.isCutout ? { x: arch.x + arch.w * 0.1, y: arch.y + arch.w * 0.25, w: arch.w * 0.8, h: arch.h - arch.w * 0.32 } : arch, t, "arch");
      text(c, d.name, W / 2, H * 0.815, { size: 64 * k, weight: 600, family: f.serif, color: t.ink, maxW: W * 0.84 });
      const sub = [money(d.price), d.plating.toUpperCase()].filter(Boolean).join("  ·  ");
      text(c, sub, W / 2, H * 0.862, { size: 26 * k, weight: 600, family: f.sans, color: t.accent, spacing: 2 * k, maxW: W * 0.84 });
      text(c, d.footer, W / 2, H * 0.945, { size: 22 * k, family: f.sans, color: t.muted, spacing: 2 * k, maxW: W * 0.84 });
    },
  },
  {
    id: "new-in",
    label: "New in",
    hint: "Big italic headline for launches and restocks.",
    defaultHeadline: "New in",
    usesHeadline: true,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      fillBackground(c, W, H, t);
      text(c, d.headline, W * 0.08, H * 0.165, { size: 150 * k, weight: 600, italic: true, family: f.serif, color: t.accent, align: "left", maxW: W * 0.84 });
      line(c, W * 0.08, H * 0.2, W * 0.36, H * 0.2, t.accent, 3);
      drawProduct(c, d, { x: W * 0.06, y: H * 0.23, w: W * 0.88, h: H * 0.56 }, t);
      text(c, d.name, W * 0.08, H * 0.855, { size: 54 * k, weight: 600, family: f.serif, color: t.ink, align: "left", maxW: W * 0.56 });
      text(c, money(d.price), W * 0.92, H * 0.855, { size: 54 * k, weight: 600, family: f.serif, color: t.accent, align: "right" });
      text(c, d.plating.toUpperCase(), W * 0.08, H * 0.89, { size: 22 * k, weight: 500, family: f.sans, color: t.muted, align: "left", spacing: 3 * k });
      line(c, W * 0.08, H * 0.918, W * 0.92, H * 0.918, t.line);
      text(c, BRAND, W * 0.08, H * 0.955, { size: 18 * k, weight: 600, family: f.sans, color: t.muted, align: "left", spacing: 5 * k });
      text(c, d.footer, W * 0.92, H * 0.955, { size: 20 * k, family: f.sans, color: t.muted, align: "right", maxW: W * 0.45 });
    },
  },
  {
    id: "gift",
    label: "Gift",
    hint: "Gift-guide look with a price tag. Good for Valentine's, Mother's Day, Diwali, Christmas.",
    defaultHeadline: "The perfect gift",
    usesHeadline: true,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      fillBackground(c, W, H, t);
      text(c, d.headline, W / 2, H * 0.115, { size: 86 * k, weight: 600, italic: true, family: f.serif, color: t.ink, maxW: W * 0.86 });
      text(c, BRAND, W / 2, H * 0.155, { size: 20 * k, weight: 600, family: f.sans, color: t.accent, spacing: 6 * k });
      drawProduct(c, d, { x: W * 0.1, y: H * 0.18, w: W * 0.8, h: H * 0.56 }, t);
      if (money(d.price)) {
        // A rotated gift tag carrying the price.
        c.save();
        c.translate(W * 0.76, H * 0.73);
        c.rotate(-0.12);
        const tw = W * 0.27, th = H * 0.1;
        c.fillStyle = t.panel;
        c.shadowColor = "rgba(0,0,0,0.15)";
        c.shadowBlur = 20 * k;
        roundRectPath(c, { x: -tw / 2, y: -th / 2, w: tw, h: th }, 16 * k);
        c.fill();
        c.shadowColor = "transparent";
        c.strokeStyle = t.accent;
        c.lineWidth = 2;
        c.stroke();
        c.beginPath();
        c.arc(-tw / 2 + 22 * k, 0, 8 * k, 0, Math.PI * 2);
        c.stroke();
        text(c, money(d.price), 12 * k, 8 * k, { size: 40 * k, weight: 600, family: f.serif, color: t.accent, maxW: tw - 60 * k });
        text(c, d.plating, 12 * k, th / 2 - 12 * k, { size: 16 * k, family: f.sans, color: t.muted, maxW: tw - 60 * k });
        c.restore();
      }
      text(c, d.name, W / 2, H * 0.855, { size: 58 * k, weight: 600, family: f.serif, color: t.ink, maxW: W * 0.84 });
      line(c, W * 0.4, H * 0.89, W * 0.6, H * 0.89, t.line);
      text(c, d.footer, W / 2, H * 0.935, { size: 22 * k, family: f.sans, color: t.muted, spacing: 2 * k, maxW: W * 0.84 });
    },
  },
  {
    id: "sale",
    label: "Special price",
    hint: "Shows the old price crossed out. Only when “compare-at” is higher than the price.",
    defaultHeadline: "Special price",
    usesHeadline: true,
    needsSale: true,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      fillBackground(c, W, H, t);
      text(c, d.headline.toUpperCase(), W / 2, H * 0.075, { size: 30 * k, weight: 600, family: f.sans, color: t.accent, spacing: 8 * k, maxW: W * 0.86 });
      drawProduct(c, d, { x: W * 0.08, y: H * 0.105, w: W * 0.84, h: H * 0.57 }, t);
      text(c, d.name, W / 2, H * 0.745, { size: 60 * k, weight: 600, family: f.serif, color: t.ink, maxW: W * 0.84 });
      const was = money(d.compareAt);
      if (was && isSale(d.price, d.compareAt)) {
        const label = `Was ${was}`;
        text(c, label, W / 2, H * 0.8, { size: 32 * k, weight: 500, family: f.sans, color: t.muted });
        setFont(c, 500, 32 * k, f.sans);
        const lw = c.measureText(label).width;
        line(c, W / 2 - lw / 2, H * 0.8 - 11 * k, W / 2 + lw / 2, H * 0.8 - 11 * k, t.muted, 2.5 * k);
      }
      text(c, money(d.price), W / 2, H * 0.885, { size: 100 * k, weight: 700, family: f.serif, color: t.accent });
      text(c, d.footer, W / 2, H * 0.95, { size: 22 * k, family: f.sans, color: t.muted, spacing: 2 * k, maxW: W * 0.84 });
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    hint: "Almost all jewellery, tiny type. For a calm, editorial grid.",
    defaultHeadline: "",
    usesHeadline: false,
    draw(c, W, H, t, d, f) {
      const k = Math.min(W / 1080, H / 1350);
      c.fillStyle = t.bg;
      c.fillRect(0, 0, W, H);
      drawProduct(c, d, { x: W * 0.06, y: H * 0.05, w: W * 0.88, h: H * 0.78 }, t);
      text(c, BRAND, W * 0.07, H * 0.885, { size: 18 * k, weight: 600, family: f.sans, color: t.muted, align: "left", spacing: 5 * k });
      text(c, d.name, W * 0.07, H * 0.94, { size: 50 * k, weight: 600, family: f.serif, color: t.ink, align: "left", maxW: W * 0.6 });
      text(c, money(d.price), W * 0.93, H * 0.94, { size: 32 * k, weight: 600, family: f.sans, color: t.accent, align: "right" });
    },
  },
];

/** Visible bounds of a transparent cut-out (scans a small copy for speed), with a little breathing room. */
export function computeTrim(img: HTMLImageElement): Box | null {
  const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.drawImage(img, 0, 0, w, h);
  const { data } = c.getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0 / scale, y: y0 / scale, w: (x1 - x0 + 1) / scale, h: (y1 - y0 + 1) / scale };
}
