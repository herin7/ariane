import type { NextConfig } from "next";

const config: NextConfig = {
  // @ariane/core ships TypeScript source with no build step. One less thing.
  transpilePackages: ["@ariane/core"],
};

export default config;
