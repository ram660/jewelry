import test from "node:test";
import assert from "node:assert/strict";
import { imageProvider, safeModeAvailable, visionProvider } from "../src/lib/config.ts";

const KEYS = ["IMAGE_PROVIDER", "VISION_PROVIDER", "AI_PROVIDER", "GEMINI_API_KEY", "FAL_KEY", "ANTHROPIC_API_KEY", "DEEPINFRA_API_KEY", "OPENROUTER_API_KEY"];
function withEnv(env: Record<string, string>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test("a Gemini key used for reasoning never switches picture-making on by itself", () => {
  withEnv({ GEMINI_API_KEY: "k" }, () => {
    assert.equal(visionProvider(), "gemini");
    assert.equal(imageProvider(), null);
  });
  withEnv({ GEMINI_API_KEY: "k", VISION_PROVIDER: "gemini" }, () => {
    assert.equal(visionProvider(), "gemini");
    assert.equal(imageProvider(), null);
  });
});

test("Gemini makes pictures only when chosen on purpose", () => {
  withEnv({ GEMINI_API_KEY: "k", IMAGE_PROVIDER: "gemini" }, () => assert.equal(imageProvider(), "gemini"));
  withEnv({ IMAGE_PROVIDER: "gemini" }, () => assert.equal(imageProvider(), null)); // chosen but no key
  withEnv({ GEMINI_API_KEY: "k", AI_PROVIDER: "gemini" }, () => assert.equal(imageProvider(), "gemini")); // the older all-in-one switch
});

test("none and demo mean no AI pictures, even with every key present", () => {
  for (const v of ["none", "demo", "NONE"]) {
    withEnv({ GEMINI_API_KEY: "k", FAL_KEY: "f", IMAGE_PROVIDER: v }, () => assert.equal(imageProvider(), null, v));
  }
});

test("a fal key still turns on fal in auto, and can be overridden", () => {
  withEnv({ FAL_KEY: "f" }, () => assert.equal(imageProvider(), "fal"));
  withEnv({ FAL_KEY: "f", IMAGE_PROVIDER: "none" }, () => assert.equal(imageProvider(), null));
});

test("safe mode is always available, because the backdrop can be drawn by code", () => {
  withEnv({}, () => assert.equal(safeModeAvailable(), true));
});
