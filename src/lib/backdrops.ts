import sharp from "sharp";
import { CANVAS } from "./composite";

/**
 * Backdrops drawn entirely by code: gradients, noise and blur, no AI and no photographs. They stand in for the AI-made
 * backdrops when the owner chooses real photos only. They are stylised surfaces, not photographs, and are kept soft and
 * quiet so the real product stays the subject. Deterministic: the same scene always draws the same picture.
 */

const { width: W, height: H } = CANVAS;

/** Small seeded random number generator, so bokeh and pebbles land in the same places every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svgWrap = (defs: string, body: string) =>
  `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;

/** Soft grain over the whole picture, so flat gradients do not look like plastic. */
const grain = (opacity: number, seed = 3) => `
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${opacity} 0"/>
  </filter>`;
const grainRect = `<rect width="${W}" height="${H}" filter="url(#grain)"/>`;

/** Soft darkening toward the edges, which also pulls the eye to the centre where the piece sits. */
const vignette = (strength: number) => `
  <radialGradient id="vig" cx="50%" cy="48%" r="72%">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${strength}"/>
  </radialGradient>`;
const vignetteRect = `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;

function bokeh(seed: number, n: number, colours: string[], rMin: number, rMax: number, opMin: number, opMax: number, avoidCentre = true): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    let x = r() * W, y = r() * H;
    // Keep the middle calmer: the product goes there.
    if (avoidCentre && Math.abs(x - W / 2) < W * 0.28 && Math.abs(y - 650) < H * 0.22) { x = r() < 0.5 ? r() * W * 0.22 : W - r() * W * 0.22; }
    const rad = rMin + r() * (rMax - rMin);
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rad.toFixed(0)}" fill="${colours[Math.floor(r() * colours.length)]}" fill-opacity="${(opMin + r() * (opMax - opMin)).toFixed(2)}"/>`;
  }
  return out;
}

type Maker = () => string;

const MAKERS: Record<string, Maker> = {
  marble: () =>
    svgWrap(
      `<radialGradient id="base" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#f6f5f2"/><stop offset="1" stop-color="#e3e1dc"/></radialGradient>
       <filter id="veins" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0014 0.0048" numOctaves="3" seed="11" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>
         <feComponentTransfer in="a"><feFuncA type="table" tableValues="0 0 0 0 0 0 0 0 0.7 0 0 0 0 0 0 0 0 0 0 0 0"/></feComponentTransfer>
         <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.51  0 0 0 0 0.55  0 0 0 1 0"/>
       </filter>
       <filter id="veins2" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0022 0.0065" numOctaves="3" seed="27" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>
         <feComponentTransfer in="a"><feFuncA type="table" tableValues="0 0 0 0 0 0 0 0 0 0.4 0 0 0 0 0 0 0 0 0 0 0"/></feComponentTransfer>
         <feColorMatrix type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.63  0 0 0 0 0.66  0 0 0 1 0"/>
       </filter>
       <filter id="soft"><feGaussianBlur stdDeviation="2"/></filter>${grain(0.05)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <g filter="url(#soft)" transform="rotate(34 540 675)"><rect x="-700" y="-700" width="2480" height="2750" filter="url(#veins2)"/><rect x="-700" y="-700" width="2480" height="2750" filter="url(#veins)"/></g>
       <rect width="${W}" height="${H}" fill="#fff" fill-opacity="0.12"/>${grainRect}`
    ),

  linen: () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe3cb"/><stop offset="1" stop-color="#dccdb0"/></linearGradient>
       <pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse">
         <rect width="6" height="6" fill="none"/><path d="M0 1.5H6" stroke="#8a7650" stroke-opacity="0.13" stroke-width="1.2"/><path d="M1.5 0V6" stroke="#8a7650" stroke-opacity="0.11" stroke-width="1.2"/>
       </pattern>
       <filter id="folds" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0022 0.0042" numOctaves="3" seed="5" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.18  1.5 0 0 0 -0.55"/>
       </filter>
       <filter id="foldsLight" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0022 0.0042" numOctaves="3" seed="9" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  1.4 0 0 0 -0.5"/>
       </filter>${grain(0.07, 8)}${vignette(0.18)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <rect width="${W}" height="${H}" filter="url(#foldsLight)" opacity="0.7"/>
       <rect width="${W}" height="${H}" filter="url(#folds)" opacity="0.5"/>
       <rect width="${W}" height="${H}" fill="url(#weave)"/>${grainRect}${vignetteRect}`
    ),

  cedar: () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfae82"/><stop offset="1" stop-color="#b98f61"/></linearGradient>
       <filter id="grainwood" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.006 0.2" numOctaves="4" seed="21" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.1  2.2 0 0 0 -0.85"/>
       </filter>
       <filter id="grainwood2" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="3" seed="4" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.95  0 0 0 0 0.8  0 0 0 0 0.6  1.6 0 0 0 -0.6"/>
       </filter>
       <filter id="soft"><feGaussianBlur stdDeviation="0.8"/></filter>${grain(0.05, 14)}${vignette(0.25)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <g filter="url(#soft)"><rect width="${W}" height="${H}" filter="url(#grainwood2)" opacity="0.55"/><rect width="${W}" height="${H}" filter="url(#grainwood)" opacity="0.85"/></g>
       ${[0.18, 0.47, 0.76].map((y) => `<rect x="0" y="${(y * H).toFixed(0)}" width="${W}" height="3" fill="#5a3b1f" fill-opacity="0.28"/>`).join("")}
       ${grainRect}${vignetteRect}`
    ),

  "rain-window": () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb0ae"/><stop offset="1" stop-color="#cdd8d5"/></linearGradient>
       <filter id="b1"><feGaussianBlur stdDeviation="14"/></filter><filter id="b2"><feGaussianBlur stdDeviation="3"/></filter>${grain(0.05, 2)}${vignette(0.2)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <g filter="url(#b1)">${bokeh(31, 26, ["#e8f0ee", "#c4d6cf", "#8fa89f", "#f4f8f6"], 40, 120, 0.25, 0.6)}</g>
       <g filter="url(#b2)">${bokeh(32, 38, ["#ffffff"], 5, 15, 0.35, 0.8, false)}</g>
       <rect y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="#e9eeec" fill-opacity="0.55"/>
       <rect y="${H * 0.62}" width="${W}" height="3" fill="#fff" fill-opacity="0.7"/>${grainRect}${vignetteRect}`
    ),

  "sea-glass": () => {
    // A bed of pebbles and a few pieces of sea glass fills the lower part of the frame and fades into soft grey-green light above.
    const r = rng(41);
    const items: { y: number; svg: string }[] = [];
    for (let i = 0; i < 95; i++) {
      const y = H * 0.6 + Math.pow(r(), 0.85) * H * 0.46;
      const x = r() * (W + 120) - 60;
      const depth = (y - H * 0.5) / (H * 0.5); // bigger toward the front of the picture
      const rx = 40 + depth * 52 + r() * 26, ry = rx * (0.62 + r() * 0.28), rot = (r() * 180).toFixed(0);
      const glass = r() < 0.09;
      const tone = ["#b9b6ae", "#c8c3b6", "#abada6", "#d4cfc2", "#a2a8a4", "#bdb2a0"][Math.floor(r() * 6)];
      // The first row of pebbles fades in, so the bed melts into the soft background instead of starting at a hard line.
      const fade = Math.min(1, Math.max(0, (y - H * 0.6) / (H * 0.12)));
      items.push({
        y,
        svg: `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot})" opacity="${fade.toFixed(2)}">
          <ellipse rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${glass ? "#cde0d7" : tone}" fill-opacity="${glass ? 0.85 : 1}" filter="url(#pebble)"/>
          <ellipse cx="${(-rx * 0.25).toFixed(0)}" cy="${(-ry * 0.32).toFixed(0)}" rx="${(rx * 0.45).toFixed(0)}" ry="${(ry * 0.28).toFixed(0)}" fill="#fff" fill-opacity="${glass ? 0.5 : 0.2}" filter="url(#hl)"/></g>`,
      });
    }
    items.sort((a, b) => a.y - b.y); // back to front
    return svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d3ddd8"/><stop offset="0.55" stop-color="#bcc8c1"/><stop offset="1" stop-color="#9aa8a1"/></linearGradient>
       <filter id="pebble" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="1.2"/></filter>
       <filter id="hl"><feGaussianBlur stdDeviation="7"/></filter>
       <filter id="bl"><feGaussianBlur stdDeviation="18"/></filter>${grain(0.06, 6)}${vignette(0.2)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <g filter="url(#bl)">${bokeh(43, 10, ["#eef4f1", "#c9d9d1"], 50, 110, 0.25, 0.5)}</g>
       ${items.map((i) => i.svg).join("")}
       ${grainRect}${vignetteRect}`
    );
  },

  "golden-hour": () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8e0b0"/><stop offset="1" stop-color="#e3b273"/></linearGradient>
       <radialGradient id="sun" cx="18%" cy="12%" r="70%"><stop offset="0" stop-color="#fff6dc" stop-opacity="0.95"/><stop offset="0.5" stop-color="#ffe9b8" stop-opacity="0.35"/><stop offset="1" stop-color="#ffe9b8" stop-opacity="0"/></radialGradient>
       <filter id="bl"><feGaussianBlur stdDeviation="26"/></filter>
       <filter id="stone" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="17" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.4  0 0 0 0 0.25  0.9 0 0 0 -0.3"/>
       </filter>${grain(0.06, 12)}${vignette(0.22)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <rect width="${W}" height="${H}" filter="url(#stone)" opacity="0.4"/>
       <rect width="${W}" height="${H}" fill="url(#sun)"/>
       <g filter="url(#bl)" fill="#7a4a1c" fill-opacity="0.16">
         <polygon points="${W * 0.35},0 ${W * 0.62},0 ${W * 1.05},${H * 0.55} ${W * 0.7},${H * 0.62}"/>
         <polygon points="${W * 0.7},0 ${W * 0.92},0 ${W * 1.1},${H * 0.25} ${W * 0.95},${H * 0.3}"/>
       </g>${grainRect}${vignetteRect}`
    ),

  "velvet-box": () =>
    svgWrap(
      `<radialGradient id="base" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#5d4650"/><stop offset="0.6" stop-color="#3a2b33"/><stop offset="1" stop-color="#1c1318"/></radialGradient>
       <filter id="pile" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="23" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.75  0 0 0 0 0.6  0 0 0 0 0.68  0.9 0 0 0 -0.35"/>
       </filter>
       <radialGradient id="spot" cx="50%" cy="48%" r="45%"><stop offset="0" stop-color="#ffe9d6" stop-opacity="0.22"/><stop offset="1" stop-color="#ffe9d6" stop-opacity="0"/></radialGradient>
       <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter>`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <rect width="${W}" height="${H}" filter="url(#pile)" opacity="0.5"/>
       <rect width="${W}" height="${H}" fill="url(#spot)"/>`
    ),

  "festive-diwali": () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3020"/><stop offset="1" stop-color="#7d5430"/></linearGradient>
       <radialGradient id="glow" cx="50%" cy="60%" r="65%"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0.45"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
       <filter id="b1"><feGaussianBlur stdDeviation="16"/></filter><filter id="b2"><feGaussianBlur stdDeviation="4"/></filter>${grain(0.06, 7)}${vignette(0.3)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
       <g filter="url(#b1)">${bokeh(51, 22, ["#ffb347", "#ffd27a", "#ff9a3c", "#fff0c2"], 30, 90, 0.3, 0.7)}</g>
       <g filter="url(#b2)">${bokeh(52, 24, ["#ffe29a", "#ffffff"], 4, 12, 0.4, 0.9, false)}</g>${grainRect}${vignetteRect}`
    ),

  "festive-red": () =>
    svgWrap(
      `<linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b53a33"/><stop offset="1" stop-color="#7d1f1c"/></linearGradient>
       <filter id="silk" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0009 0.0038" numOctaves="2" seed="29" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 0.8  0 0 0 0 0.72  2.4 0 0 0 -1"/>
       </filter>
       <filter id="silkDark" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="0.0009 0.0038" numOctaves="2" seed="33" result="t"/>
         <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.18  0 0 0 0 0.02  0 0 0 0 0.02  2.4 0 0 0 -0.95"/>
       </filter>
       <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>
       <filter id="silkBlur"><feGaussianBlur stdDeviation="9"/></filter>${grain(0.05, 10)}${vignette(0.28)}`,
      `<rect width="${W}" height="${H}" fill="url(#base)"/>
       <g transform="rotate(-28 540 675)" filter="url(#silkBlur)"><rect x="-700" y="-700" width="2480" height="2750" filter="url(#silk)" opacity="0.7"/><rect x="-700" y="-700" width="2480" height="2750" filter="url(#silkDark)" opacity="0.75"/></g>
       <g filter="url(#soft)">
         <path d="M ${W * 0.78} ${H * 0.9} q 60 -50 130 -20" stroke="#e8c15a" stroke-width="7" fill="none" stroke-linecap="round" stroke-opacity="0.85"/>
         <circle cx="${W * 0.86}" cy="${H * 0.93}" r="9" fill="#f1d27a" fill-opacity="0.9"/><circle cx="${W * 0.8}" cy="${H * 0.96}" r="5" fill="#e8c15a" fill-opacity="0.85"/>
         <circle cx="${W * 0.93}" cy="${H * 0.89}" r="4" fill="#f6e3a0" fill-opacity="0.9"/>
       </g>${grainRect}${vignetteRect}`
    ),
};

export const DRAWN_SCENES = Object.keys(MAKERS);

/** A 4:5 backdrop for a scene id, drawn by code. Throws for an unknown scene. */
export async function drawnBackdrop(sceneId: string): Promise<Buffer> {
  const make = MAKERS[sceneId];
  if (!make) throw new Error(`There is no drawn backdrop for the scene "${sceneId}".`);
  return sharp(Buffer.from(make())).jpeg({ quality: 90 }).toBuffer();
}
