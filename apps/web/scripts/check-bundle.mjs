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

/**
 * Strings that only exist in the seed or in the server only dependencies.
 *
 * `supabaseUrl` rather than `supabase`: the voice guardrails carry a regex
 * labelled `supabase-key` for spotting a leaked credential in what the model
 * says, and that is a filter shipping to the browser on purpose. The SDK is
 * what must not ship, so the needle is a string only the SDK has.
 */
const FORBIDDEN = [
  ["Mamlatdar", "the graph seed"],
  ["parivahan.gov.in", "the graph seed"],
  ["cpgrams", "the graph seed"],
  ["supabaseUrl", "the Supabase SDK"],
  ["@supabase/", "the Supabase SDK"],
];

/**
 * And no secret, ever. §8, §24.
 *
 * Names rather than values, because a value is only in the environment of the
 * machine that builds and this has to fail on a laptop with an empty `.env`
 * too. Next inlines `process.env.X` into client code when it can see it, so a
 * `"use client"` file that reads one of these leaves the literal name behind in
 * a chunk — which is exactly what this catches.
 *
 * `NEXT_PUBLIC_SUPABASE_*` is deliberately not here: a publishable key is meant
 * to reach a browser, and every telemetry table has RLS on with no policies, so
 * it cannot read one row of them.
 */
const SECRET_NAMES = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_SESSION_SECRET",
  "SUPABASE_API_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "VAPI_API_KEY",
  "VAPI_WEBHOOK_SECRET",
  "RATE_LIMIT_SECRET",
  "VOICE_SESSION_SECRET",
  "VOICE_PHONE_HMAC_SECRET",
  "AWS_BEARER_TOKEN_BEDROCK",
  "SARVAM_API_KEY",
  "CRON_SECRET",
];

/**
 * And no live credential either, in case one is ever pasted into source rather
 * than read from the environment. Shapes, not values.
 */
const SECRET_SHAPES = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "an OpenAI-style key"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, "a JWT"],
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
  for (const name of SECRET_NAMES) {
    if (content.includes(name)) problems.push(`${file} names a server secret: ${name}`);
  }
  for (const [shape, what] of SECRET_SHAPES) {
    if (shape.test(content)) problems.push(`${file} looks like it contains ${what}`);
  }
}

/**
 * The environment Next was given, checked against what it is allowed to inline.
 *
 * A build machine with real values is the case that matters: if any secret's
 * *value* made it into a chunk, the name check above would miss it. Only run
 * when the variable is actually set, and never printed. §8, §24.
 */
for (const name of SECRET_NAMES) {
  const value = process.env[name];
  // Short values produce false positives against minified identifiers.
  if (!value || value.length < 16) continue;
  for (const file of files) {
    if (readFileSync(file, "utf8").includes(value)) problems.push(`${file} contains the VALUE of ${name}`);
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
