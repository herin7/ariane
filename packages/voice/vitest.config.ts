import { defineConfig } from "vitest/config";

// Same reasoning as packages/core: the seed is large and the reporter socket
// starves under the forks pool on Windows. See that file for the long version.
export default defineConfig({
  json: { stringify: true },
  test: { pool: "threads" },
});
