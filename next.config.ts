import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["sharp"],
  // Your home folder has its own package-lock.json; pin the root to this project.
  outputFileTracingRoot: process.cwd(),
};

export default config;
