import { describe, expect, it } from "vitest";
import { seedBundles } from "../data/index";

/**
 * A regression for a fact that existed and was never shown.
 *
 * The ingest script wrote opening times to `metadata.hours`. The compiler reads
 * `metadata.workingHours`. Both sides were internally consistent, nothing threw,
 * validation passed, and 38 offices' published hours were dropped on the floor
 * between the graph and the screen. Nothing caught it because a missing
 * optional field looks exactly like a source that never printed one.
 */

const offices = seedBundles.flatMap((b) => b.nodes).filter((n) => n.type === "OFFICE");

describe("an office's opening hours reach the compiler", () => {
  it("has offices with hours at all, so this test cannot pass by being empty", () => {
    expect(offices.filter((o) => o.metadata?.workingHours).length).toBeGreaterThan(0);
  });

  // The typed name is the only name. Anything else is a fact with no reader.
  it("stores them under workingHours, the name the compiler reads", () => {
    const wrong = offices.filter((o) => o.metadata && "hours" in o.metadata);
    expect(wrong.map((o) => o.id)).toEqual([]);
  });

  it("keeps them as a string, not an array or an object the UI would render as [object Object]", () => {
    for (const office of offices) {
      const hours = office.metadata?.workingHours;
      if (hours !== undefined) expect(typeof hours, office.id).toBe("string");
    }
  });
});
