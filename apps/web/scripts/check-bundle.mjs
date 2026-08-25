import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser must not be sent the graph.
 *
 * `@ariane/core`'s root re-exports `loadGraph`, which statically imports every
 * seed file. One client component importing a type from the package root was
 * enough to ship 400kB of government data to every phone that opened the
 * journey page, and nothing failed: the build was green and the page worked.
 * It only showed up as a number in a table nobody reads twice.
 *
 * So it is a check now. Runs after every build, including CI.
 *
 * Two things keep it out: `"sideEffects": false` on the package, so webpack can
 * drop the unused seed imports, and the database layer living behind
 * `@ariane/core/server` rather than the root.
 */

const CHUNKS = ".next/static/chunks";

// Strings that only exist in the seed or in the server only dependencies.
const FORBIDDEN = [
  ["Mamlatdar", "the graph seed"],
  ["parivahan.gov.in", "the graph seed"],
  ["cpgrams", "the graph seed"],
  ["supabase", "the Supabase SDK"],
];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".js")) files.push(path);
  }
};
walk(CHUNKS);

const problems = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const [needle, what] of FORBIDDEN) {
    if (content.toLowerCase().includes(needle.toLowerCase())) problems.push(`${file} contains ${what} ("${needle}")`);
  }
}

/**
 * And the phone, which webpack cannot save.
 *
 * The browser gets away with importing the package root because webpack reads
 * `"sideEffects": false` and drops the unused seed. Metro does not tree shake,
 * so on Expo the same import is not a warning, it is the whole graph: one
 * `import { stageGroups } from "@ariane/core"` took the dev bundle from 4.3MB
 * to 10.9MB and put 11471 verbatim government quotes on the device, where they
 * sit and go stale while the server's copy moves on.
 *
 * Checked by reading the source rather than by building a bundle, because
 * asserting the rule is cheaper than asserting the consequence and this gate
 * runs on every commit. Type imports are erased at build and are fine.
 */
const mobileApp = join("..", "mobile", "App.tsx");
const mobile = readFileSync(mobileApp, "utf8");
for (const line of mobile.split("\n")) {
  const root = /^import\s+(.*)\s+from\s+"@ariane\/core"/.exec(line);
  if (root && !root[1].startsWith("type ")) {
    problems.push(`${mobileApp} imports values from the package root: ${line.trim()}`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} thing(s) leaked into a client bundle:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nSomething imported from the package root where it should have used a leaf or @ariane/core/server.");
  process.exit(1);
}

console.log(`client bundle clean, ${files.length} chunk(s) checked, phone imports no data`);
