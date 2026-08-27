/**
 * The thread's geometry, checked without a browser.
 *
 * `arc` is the only part of the animation that is arithmetic rather than
 * choreography, so it is the only part worth a test. Run with:
 *
 *   node --experimental-strip-types scripts/check-thread.mjs
 */
import assert from "node:assert/strict";
import { arc } from "../app/thread.ts";

const parse = (d) => {
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.equal(n.length, 6, `expected M x y Q cx cy x y, got ${d}`);
  return { from: { x: n[0], y: n[1] }, control: { x: n[2], y: n[3] }, to: { x: n[4], y: n[5] } };
};

/** The bow, recovered: how far the control point sits off the straight line. */
const bowOf = (from, to) => {
  const { control } = parse(arc(from, to));
  return Math.hypot(control.x - (from.x + to.x) / 2, control.y - (from.y + to.y) / 2);
};

// It goes from where you clicked to where you are going, exactly.
{
  const from = { x: 1180, y: 34 };
  const to = { x: 420, y: 610 };
  const path = parse(arc(from, to));
  assert.deepEqual(path.from, from, "thread does not start at the button");
  assert.deepEqual(path.to, to, "thread does not end at the target");
}

// The bow is clamped at both ends: a short throw still hangs, and a throw down
// a very tall page does not loop out of the viewport.
assert.ok(Math.abs(bowOf({ x: 0, y: 0 }, { x: 0, y: 30 }) - 18) < 0.01, "short throw lost its bow");
assert.ok(Math.abs(bowOf({ x: 0, y: 0 }, { x: 0, y: 9000 }) - 90) < 0.01, "long throw was not clamped");
assert.ok(Math.abs(bowOf({ x: 0, y: 0 }, { x: 0, y: 300 }) - 48) < 0.01, "mid throw bowed the wrong amount");

// Perpendicular, not just offset: the control point is square to the line, or
// the thread leans instead of hanging.
{
  const from = { x: 0, y: 0 };
  const to = { x: 300, y: 400 };
  const { control } = parse(arc(from, to));
  const mid = { x: 150, y: 200 };
  const dot = (control.x - mid.x) * (to.x - from.x) + (control.y - mid.y) * (to.y - from.y);
  assert.ok(Math.abs(dot) < 1e-6, "control point is not perpendicular to the throw");
}

// Clicking "Find my path" while already sitting on it. Zero distance divides by
// the length, so without the `|| 1` guard every coordinate here is NaN and the
// browser silently drops the path.
{
  const d = arc({ x: 500, y: 300 }, { x: 500, y: 300 });
  assert.ok(!/NaN/.test(d), `zero-length throw produced NaN: ${d}`);
  for (const value of parse(d) && d.match(/-?\d+(\.\d+)?/g).map(Number)) {
    assert.ok(Number.isFinite(value), `non-finite coordinate in ${d}`);
  }
}

console.log("ok: thread geometry (endpoints, clamped bow, perpendicular, zero-length)");
