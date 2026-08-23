import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A field on a step that no screen reads.
 *
 * Four times now. `processingDays` was written by the compiler and printed
 * nowhere. `machineExtracted` said which services nobody had read and stopped
 * at the database, so a machine's reading and a researcher's reading arrived in
 * the same typeface. `couldBlock` held the most useful sentence in the
 * scholarship journey and reached no one. And twice the two clients disagreed
 * with each other: the phone said "Read as" for a translated question and the
 * browser did not, the browser printed "matched on  (25% sure)" with the gap
 * where the words go.
 *
 * The compiler cannot catch this. A field is optional, both clients typecheck
 * without it, every test passes, and the citizen is the one who finds out. So
 * this reads the interface and both screens as text and says which field went
 * nowhere.
 *
 * Crude on purpose. It greps. `step.fee` in a comment counts, and a field
 * rendered through a destructure would be missed. It is a smoke alarm, not a
 * type system, and a smoke alarm that goes off four times is worth its noise.
 */

const here = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const types = here("../types.ts");
const screens = {
  web: here("../../../../apps/web/app/journey/view.tsx"),
  mobile: here("../../../../apps/mobile/App.tsx"),
  cli: here("../cli/journey.ts"),
};

/** Fields on the step that are deliberately not shown, and why. */
const NOT_SHOWN: Record<string, string> = {
  nodeId: "a graph id, and the whole point is the citizen never sees one",
  order: "the position in the list is the number, printing it twice is not honesty",
  type: "SERVICE or ACTION is our vocabulary, not theirs",
  dependsOn: "the ordering is the answer. Naming its causes as ids is not",
  produces: "shown as the documents you end up holding, not as the edge",
  lastVerifiedAt:
    "every source under the step already carries the date it was retrieved, and two dates that mean almost the same thing is worse than one",
};

function fieldsOf(name: string): string[] {
  const start = types.indexOf(`export interface ${name}`);
  expect(start).toBeGreaterThan(-1);
  const body = types.slice(start, types.indexOf("\n}", start));
  // Two spaces of indent, so nested object literals inside a doc comment or a
  // union member do not read as fields of the interface itself.
  return [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1] as string);
}

describe("every field on a step reaches a screen", () => {
  const fields = fieldsOf("JourneyStep");

  it("found the interface", () => {
    expect(fields.length).toBeGreaterThan(15);
    expect(fields).toContain("couldBlock");
  });

  for (const field of fields) {
    if (NOT_SHOWN[field]) {
      it(`${field} is deliberately not shown`, () => {
        expect(NOT_SHOWN[field]).toBeTruthy();
      });
      continue;
    }
    it(`${field} is read by the web and the phone`, () => {
      // The cli is not required. It is a development tool and prints what it
      // prints; the two things a citizen holds are the ones that must agree.
      expect(screens.web.includes(`.${field}`)).toBe(true);
      expect(screens.mobile.includes(`.${field}`)).toBe(true);
    });
  }
});
