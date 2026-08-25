import { defineConfig } from "vitest/config";

/**
 * The graph outgrew the defaults.
 *
 * `data/graph/` is 5.6MB of JSON now, and every test file that touches
 * `loadGraph()` pulls all of it. Vite's default JSON handling rewrites a bundle
 * into a JavaScript object literal, which V8 then has to parse as source. That
 * is the slowest way to get 5.6MB of data into a process, and the run was
 * spending 48s in transform and 80s in collect doing it fourteen times over.
 *
 * `stringify` emits `JSON.parse("...")` instead. Same value, one string
 * literal, and V8's JSON parser rather than its source parser.
 */
export default defineConfig({
  json: { stringify: true },
  test: {
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
