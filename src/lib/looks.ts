/** The studio-shot looks (labels only), shared by the server renderer (look.ts) and the Studio page. */

export type LogoInk = "dark" | "light";

export const LOOKS = {
  cream: { label: "Cream studio", reflection: false, ink: "dark" },
  gloss: { label: "Glossy reflection", reflection: true, ink: "dark" },
  dark: { label: "Dark spotlight", reflection: true, ink: "light" },
  linen: { label: "Woven linen", reflection: false, ink: "dark" },
} as const satisfies Record<string, { label: string; reflection: boolean; ink: LogoInk }>;

export type LookId = keyof typeof LOOKS;
export const LOOK_IDS = Object.keys(LOOKS) as LookId[];
// Object.hasOwn, not `in`: "constructor" or "toString" must not count as looks.
export const isLook = (v: unknown): v is LookId => typeof v === "string" && Object.hasOwn(LOOKS, v);
