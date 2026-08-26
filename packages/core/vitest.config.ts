import { defineConfig } from "vitest/config";
import { graphOrigin } from "./src/data/providers";

/**
 * Two suites in one directory, told apart by what they need to be true.
 *
 * Most of these files assert government facts: that a widow's pension journey
 * names four disagreeing figures, that 38 offices publish hours, that "aavak nu
 * dakhlo" resolves to an income certificate. None of that can be asserted
 * against `fixtures/demo`, which is four invented nodes about a tree, and none
 * of it belongs in a public clone either, because the graph behind it is
 * third-party government content that is not in this repository.
 *
 * So: with a snapshot on disk, everything runs. Without one, the files that
 * need real rows are skipped and the ones that prove the machinery — the
 * compiler, the validator, the index cache, the row round trip — run on the
 * fixture. `pnpm gates` is the first. `pnpm gates:integration` refuses to start
 * without a snapshot and is the second.
 *
 * Skipped at the file level rather than inside each `describe`, because these
 * files call `loadGraph()` at module scope and a skipped test that still
 * evaluates its module is a skipped test that still throws.
 */
const NEEDS_REAL_GRAPH = [
  "src/__tests__/certificates.test.ts",
  "src/__tests__/driving-licence.test.ts",
  "src/__tests__/every-service.test.ts",
  "src/__tests__/intent.test.ts",
  "src/__tests__/office-hours.test.ts",
  "src/__tests__/pension.test.ts",
  "src/__tests__/pf.test.ts",
  "src/__tests__/scholarship.test.ts",
  "src/__tests__/stage-groups.test.ts",
];

const onFixtures = graphOrigin() === "fixture";
if (onFixtures) {
  console.log(`No graph snapshot on disk. Skipping ${NEEDS_REAL_GRAPH.length} suite(s) that assert real government facts.`);
  console.log("Run `pnpm data:sync` and `pnpm gates:integration` to include them.");
}

/**
 * The graph outgrew the defaults.
 *
 * A snapshot is 7MB of JSON, and every test file that touches `loadGraph()`
 * pulls all of it. Vite's default JSON handling rewrites a bundle into a
 * JavaScript object literal, which V8 then has to parse as source. That is the
 * slowest way to get 7MB of data into a process, and the run was spending 48s
 * in transform and 80s in collect doing it fourteen times over.
 *
 * `stringify` emits `JSON.parse("...")` instead. Same value, one string
 * literal, and V8's JSON parser rather than its source parser.
 */
export default defineConfig({
  json: { stringify: true },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", ...(onFixtures ? NEEDS_REAL_GRAPH : [])],
    /**
     * Threads, not forks.
     *
     * Every finished test makes the worker await `onTaskUpdate` on the main
     * process, and there are 971 of them, 700 in `every-service.test.ts` alone.
     * Under the default `forks` pool each of those round trips is IPC between
     * two OS processes, which on Windows is a named pipe. That was costing tens
     * of milliseconds per test, and once the queue behind it grew past birpc's
     * 60s ceiling the run aborted with `Timeout calling "onTaskUpdate"` and all
     * 971 tests green, which is a confusing way to say the reporter socket
     * starved.
     *
     * Threads pass the same messages over a MessagePort in one process. Nothing
     * here needs process isolation: no test spawns a child, mutates the
     * environment, or touches a native module.
     */
    pool: "threads",
  },
});
