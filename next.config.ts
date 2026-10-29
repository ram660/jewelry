import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["sharp", "onnxruntime-node"],
  // Your home folder has its own package-lock.json; pin the root to this project.
  outputFileTracingRoot: process.cwd(),
  // A test server or a build check can use its own folder, so it doesn't disturb the Studio that is running.
  distDir: process.env.EFJ_DIST_DIR || ".next",
  experimental: {
    // src/middleware.ts makes Next buffer request bodies, by default only the first 10 MB. Several phone photos are more
    // than that, and a cut-off upload fails ("Failed to fetch"). The Instagram page also shrinks photos before sending.
    middlewareClientMaxBodySize: "100mb",
  },
};

export default config;
