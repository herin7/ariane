import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretPauseRead, pausedFromValue } from "./pause-value.ts";

test("an explicit false is the only value that hides the notice", () => {
  assert.equal(pausedFromValue({ paused: false }), false);
  assert.equal(interpretPauseRead({ configured: true, error: null, value: { paused: false } }).paused, false);
});

test("everything else leaves the notice up", () => {
  for (const value of [undefined, null, {}, { paused: true }, { paused: "false" }, { paused: 0 }, "false", []]) {
    assert.equal(pausedFromValue(value), true, JSON.stringify(value));
  }
});

test("no database, a missing table, and a failed read cannot clear the notice", () => {
  assert.deepEqual(interpretPauseRead({ configured: false }), {
    paused: true,
    writable: false,
    reason: "no-database",
  });
  assert.deepEqual(
    interpretPauseRead({
      configured: true,
      error: { code: "PGRST205", message: "Could not find the table public.ariane_settings" },
      value: undefined,
    }),
    { paused: true, writable: false, reason: "not-installed" },
  );
  assert.deepEqual(interpretPauseRead({ configured: true, error: { message: "timeout" }, value: undefined }), {
    paused: true,
    writable: false,
    reason: "unavailable",
  });
});

test("a missing row is still the pause, and an admin can write it", () => {
  assert.deepEqual(interpretPauseRead({ configured: true, error: null, value: undefined }), {
    paused: true,
    writable: true,
  });
});
