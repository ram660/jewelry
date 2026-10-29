// Makes the shop's own music beds for Reels: original tracks synthesised from plain tones (no samples, no recordings,
// no copyrighted material), so they are free to use anywhere. Each one is 24 s and loops cleanly (the reverb tail wraps
// round to the start). Mastered to about -16 LUFS with ffmpeg's loudnorm, saved as MP3 in the audio folder.
//
//   node scripts/make-music-beds.mjs            (writes into ./audio, or EFJ_AUDIO_DIR)
//
// Server-side helper only. Needs ffmpeg (winget install Gyan.FFmpeg).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SR = 44100;
const DUR = 24;
const TAIL = 5;
const N = (DUR + TAIL) * SR;

// ---------------------------------------------------------------- ffmpeg

function findFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true });
  if (r.status === 0) return "ffmpeg";
  const base = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  try {
    for (const d of fs.readdirSync(base).filter((n) => n.startsWith("Gyan.FFmpeg"))) {
      for (const sub of fs.readdirSync(path.join(base, d))) {
        const exe = path.join(base, d, sub, "bin", "ffmpeg.exe");
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch { /* not installed */ }
  return null;
}

// ---------------------------------------------------------------- notes and timbres

const NOTE = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const hz = (name) => {
  const m = name.match(/^([A-G][#b]?)(\d)$/);
  return 440 * 2 ** ((NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
};

/** A small seeded random generator, so every run makes the same tracks. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMBRES = {
  // Warm pad: soft harmonics and a slightly detuned twin for width. Slow attack, long release.
  pad: { partials: [[1, 1], [2, 0.22], [3, 0.06]], detune: 1.0035, decay: null },
  // Bell: a few inharmonic partials that die away quickly, the higher ones faster.
  bell: { partials: [[1, 1], [2.0, 0.3], [3.01, 0.12], [4.2, 0.05]], detune: null, decay: 1.4 },
  // Soft piano-like pluck.
  pluck: { partials: [[1, 1], [2, 0.35], [3, 0.15], [4, 0.07], [5, 0.03]], detune: null, decay: 1.6 },
  // Round sine with a touch of octave, for arpeggios.
  soft: { partials: [[1, 1], [2, 0.12]], detune: null, decay: 1.8 },
};

function addNote(L, R, freq, t0, dur, { amp = 0.1, attack = 0.01, release = 0.4, timbre = "soft", pan = 0 } = {}) {
  const tb = TIMBRES[timbre];
  const start = Math.round(t0 * SR);
  const len = Math.round((dur + release) * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
  const voices = tb.detune ? [1, tb.detune] : [1];
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    // Raised-cosine attack and release: no clicks.
    let env = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    if (t > dur) env *= 0.5 + 0.5 * Math.cos((Math.PI * Math.min(1, (t - dur) / release)));
    let s = 0;
    for (const v of voices) {
      for (const [k, a] of tb.partials) {
        const decay = tb.decay ? Math.exp(-t / (tb.decay / (0.6 + 0.4 * k))) : 1;
        s += a * decay * Math.sin(2 * Math.PI * freq * k * v * t);
      }
    }
    s *= (env * amp) / voices.length;
    L[start + i] += s * gl;
    R[start + i] += s * gr;
  }
}

// ---------------------------------------------------------------- reverb and filters

/** A small Schroeder reverb (four damped combs, two all-passes) per channel, slightly different on each side. */
function reverb(x, { wet = 0.3, feedback = 0.82, damp = 0.25, spread = 0 } = {}) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d + spread), i: 0, lp: 0 }));
  const aps = [556, 441].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.buf[c.i] = x[n] * 0.015 + c.lp * feedback;
      c.i = (c.i + 1) % c.buf.length;
      acc += y;
    }
    for (const a of aps) {
      const b = a.buf[a.i];
      const y = -acc + b;
      a.buf[a.i] = acc + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      acc = y;
    }
    out[n] = x[n] * (1 - wet) + acc * wet * 4;
  }
  return out;
}

/** Gentle one-pole low-pass, to take any edge off the top. */
function lowpass(x, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let n = 0; n < x.length; n++) x[n] = y = (1 - a) * x[n] + a * y;
  return x;
}

// ---------------------------------------------------------------- the tracks

const chordsOf = (names) => names.map((c) => c.split(" ").map(hz));

function softGlow(L, R) {
  const chords = chordsOf(["C3 G3 B3 D4 E4", "A2 E3 G3 B3 C4", "F2 C3 E3 G3 A3", "G2 D3 E3 G3 B3"]);
  chords.forEach((ch, i) => {
    ch.forEach((f, j) => addNote(L, R, f, i * 6, 6.6, { amp: 0.075, attack: 1.8, release: 2.2, timbre: "pad", pan: (j - 2) * 0.18 }));
    addNote(L, R, ch[2] * 2, i * 6 + 0.4, 0.2, { amp: 0.035, attack: 0.01, release: 3, timbre: "bell", pan: 0.3 });
  });
}

function sparkle(L, R) {
  const rand = rng(7);
  const scale = ["C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6"].map(hz);
  let at = 3;
  for (let t = 0, k = 0; t < DUR - 0.3; t += 0.3, k++) {
    if (rand() < 0.22) continue;
    at = Math.max(0, Math.min(scale.length - 1, at + Math.round((rand() - 0.5) * 4)));
    addNote(L, R, scale[at], t, 0.1, { amp: 0.09 * (k % 4 === 0 ? 1 : 0.75), attack: 0.004, release: 1.6, timbre: "bell", pan: k % 2 ? 0.35 : -0.35 });
  }
  chordsOf(["C3 G3 E4", "A2 E3 C4", "F2 C3 A3", "G2 D3 B3"]).forEach((ch, i) =>
    ch.forEach((f) => addNote(L, R, f, i * 6, 6.4, { amp: 0.04, attack: 1.5, release: 2, timbre: "pad" }))
  );
}

function sundayMorning(L, R) {
  // G, D/F#, Em, C: a bar each (3 s at 80 bpm), twice.
  const bars = [["G2", "G3 B3 D4"], ["F#2", "D3 A3 D4 F#4"], ["E2", "E3 G3 B3"], ["C2", "C3 G3 C4 E4"]];
  for (let b = 0; b < 8; b++) {
    const [bass, chord] = bars[b % 4];
    const t = b * 3;
    addNote(L, R, hz(bass), t, 2.6, { amp: 0.11, attack: 0.01, release: 0.8, timbre: "pluck" });
    chord.split(" ").map(hz).forEach((f, j) => {
      addNote(L, R, f, t + 0.02 * j, 1.2, { amp: 0.06, attack: 0.008, release: 0.9, timbre: "pluck", pan: (j - 1.5) * 0.2 });
      addNote(L, R, f, t + 1.5 + 0.02 * j, 1.0, { amp: 0.04, attack: 0.008, release: 0.9, timbre: "pluck", pan: (j - 1.5) * 0.2 });
    });
  }
}

function eveningShimmer(L, R) {
  const chords = chordsOf(["D4 F4 A4 C5 E5", "Bb3 D4 F4 A4 C5", "F4 A4 C5 E5 G5", "C4 E4 G4 B4 D5"]);
  chords.forEach((ch, i) => {
    const order = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 3, 1, 2, 3, 4];
    order.forEach((n, k) => {
      const t = i * 6 + k * 0.375;
      addNote(L, R, ch[n], t, 0.25, { amp: 0.065, attack: 0.02, release: 1.4, timbre: "soft", pan: Math.sin((t / DUR) * 2 * Math.PI) * 0.5 });
    });
    addNote(L, R, ch[0] / 2, i * 6, 6.4, { amp: 0.04, attack: 1.6, release: 2, timbre: "pad" });
  });
}

const TRACKS = [
  { file: "Soft glow.mp3", make: softGlow, wet: 0.32, cutoff: 5000, about: "warm, slow pad chords with a soft bell" },
  { file: "Sparkle.mp3", make: sparkle, wet: 0.3, cutoff: 7000, about: "light bell plucks over a quiet pad" },
  { file: "Sunday morning.mp3", make: sundayMorning, wet: 0.25, cutoff: 5500, about: "gentle piano-like chords, 80 bpm" },
  { file: "Evening shimmer.mp3", make: eveningShimmer, wet: 0.42, cutoff: 6000, about: "slow, airy arpeggio with a long reverb" },
];

// ---------------------------------------------------------------- render

function wav(L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  return buf;
}

function render(track) {
  const L = new Float32Array(N), R = new Float32Array(N);
  track.make(L, R);
  const l = lowpass(reverb(L, { wet: track.wet }), track.cutoff);
  const r = lowpass(reverb(R, { wet: track.wet, spread: 23 }), track.cutoff);
  // Fold the tail onto the start, so the end runs straight into the beginning when it loops.
  const outL = l.slice(0, DUR * SR), outR = r.slice(0, DUR * SR);
  for (let i = DUR * SR; i < N; i++) { outL[i - DUR * SR] += l[i]; outR[i - DUR * SR] += r[i]; }
  let peak = 0;
  for (let i = 0; i < outL.length; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const g = 0.5 / (peak || 1);
  for (let i = 0; i < outL.length; i++) { outL[i] *= g; outR[i] *= g; }
  return wav(outL, outR);
}

function master(ffmpeg, src, out) {
  // Two-pass loudnorm: measure, then apply linearly, so the music keeps its natural dynamics.
  const first = spawnSync(ffmpeg, ["-hide_banner", "-i", src, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const m = JSON.parse(first.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const af = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const second = spawnSync(ffmpeg, ["-hide_banner", "-y", "-i", src, "-af", af, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", out], { encoding: "utf8", windowsHide: true });
  if (second.status !== 0) throw new Error(`ffmpeg failed on ${path.basename(out)}: ${second.stderr.slice(-300)}`);
}

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error("ffmpeg isn't installed. Install it with: winget install Gyan.FFmpeg");
  process.exit(1);
}
const outDir = path.resolve(process.env.EFJ_AUDIO_DIR || "audio");
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "efj-beds-"));
try {
  for (const t of TRACKS) {
    const w = path.join(tmp, "bed.wav");
    fs.writeFileSync(w, render(t));
    master(ffmpeg, w, path.join(outDir, t.file));
    console.log(`${t.file}: ${t.about}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.writeFileSync(
  path.join(outDir, "EFJ music beds - licence.txt"),
  `EFJ Studio music beds
=====================

${TRACKS.map((t) => `${t.file.padEnd(22)} ${t.about}`).join("\n")}

These tracks were generated for Elegant Fashion Jewellery by scripts/make-music-beds.mjs on ${new Date().toISOString().slice(0, 10)}.
They are synthesised from plain tones by code: no samples, recordings or anyone else's music are used.
The shop is free to use them in any post, Reel or Story, for any purpose. No credit needed.
Remake them any time with: node scripts/make-music-beds.mjs
`
);
console.log(`Saved in ${outDir}`);
