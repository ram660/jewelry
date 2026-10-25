import { Cormorant_Garamond, Montserrat } from "next/font/google";

// Downloaded once at build time and served by the app itself (no request to Google from the browser).
// Used by the poster maker, which draws text onto a canvas.
export const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const sans = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
