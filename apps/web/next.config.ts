import type { NextConfig } from "next";

/**
 * One `.env` at the repo root, not one per app.
 *
 * Next only looks in its own directory, and the CLIs in `packages/core` need
 * the same Supabase credentials the web app does. Two copies of a secret is one
 * copy too many, so load the root file here. Node's own loader, no dependency,
 * and it is a no-op when the file does not exist.
 */
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // No .env. Correct and supported: the seed answers and every key is optional.
}

const config: NextConfig = {
  // @ariane/core ships TypeScript source with no build step. One less thing.
  transpilePackages: ["@ariane/core"],
};

export default config;
