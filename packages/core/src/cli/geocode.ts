import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedJurisdictions } from "../data/index";
import { addressHash, geocodeQueries, gradeCandidate, reconcileConflict, type GateResult, type GeocodeCandidate } from "../location";
import type { DerivedLocation, GraphNode } from "../types";

/**
 * Derive a coordinate for every office that publishes an address.
 *
 *   pnpm offices:geocode              geocode what is missing, write the bundle
 *   pnpm offices:geocode --dry        say what would change, write nothing
 *   pnpm offices:geocode --limit 20   stop after 20 network calls
 *   pnpm offices:geocode --recheck    ignore the cache and ask again
 *
 * OpenStreetMap's Nominatim, which is free, keyless, and run on donated
 * hardware, so this makes at most one request a second and identifies itself.
 * A full run over 269 addressed offices therefore takes about five minutes and
 * is meant to be run rarely.
 *
 * Nothing here decides whether a coordinate is good enough to show. That is
 * `gradeCandidate` in ../location, which the app and the tests share, so the
 * rule that rejects a city centroid is one rule in one place rather than a
 * pipeline opinion the UI has to trust.
 *
 * The raw responses are cached under .ingest/, which is not committed: they are
 * third-party data and they are large. What lands in the repository is one
 * small `location` object per office, and a review file listing only the ones a
 * human has to look at.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const GRAPH = resolve(ROOT, "packages/core/src/data/graph");
const CACHE = resolve(ROOT, ".ingest/geocode.json");
const REVIEW = resolve(ROOT, "artifacts/location-review.json");

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/**
 * Nominatim's usage policy asks for an identifying User-Agent with a way to get
 * in touch. A request without one is blocked, and rightly.
 */
const USER_AGENT = "Ariane/0.1 (Gujarat government service graph; https://github.com/herin7/ariane)";

/** One request per second is the published limit. The extra 200ms is slack. */
const INTERVAL_MS = 1200;

/** How long to wait after a 429, in order. Running out of these ends the run. */
const BACKOFF_MS = [30_000, 120_000, 300_000];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const jurisdictionNames = new Map(seedJurisdictions.map((j) => [j.id, j.name]));

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type Cached = { query: string; candidate?: GeocodeCandidate; at: string };

const cache: Record<string, Cached> = existsSync(CACHE) && !flag("recheck") ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

function saveCache() {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// The one network call
// ---------------------------------------------------------------------------

let lastCallAt = 0;
let calls = 0;
let interval = INTERVAL_MS;

async function geocode(query: string, attempt = 0): Promise<GeocodeCandidate | undefined> {
  const wait = interval - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  calls++;

  const url = `${ENDPOINT}?${new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    countrycodes: "in",
  })}`;

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
  if (!response.ok) {
    // A 429 means we are being rude, so the answer is to wait longer, not to
    // retry harder. Each one also permanently slows the run down: their limit
    // is a guideline and their patience is the real one.
    if (response.status === 429) {
      if (attempt >= BACKOFF_MS.length) throw new Error("Nominatim is still rate limiting us. Stop, wait an hour, and run again.");
      const pause = BACKOFF_MS[attempt]!;
      console.error(`  ! rate limited, waiting ${pause / 1000}s`);
      await new Promise((r) => setTimeout(r, pause));
      interval += 200;
      return geocode(query, attempt + 1);
    }
    console.error(`  ! ${response.status} for ${query}`);
    return undefined;
  }

  const [first] = (await response.json()) as NominatimResult[];
  if (!first) return undefined;
  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    displayName: first.display_name,
    addressType: first.addresstype ?? first.type,
    address: first.address,
    boundingBox: first.boundingbox?.map(Number) as GeocodeCandidate["boundingBox"],
  };
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
  boundingbox?: [string, string, string, string];
}

/** Cached lookup. The cache is keyed by query, so two offices at one address cost one call. */
async function lookup(query: string): Promise<GeocodeCandidate | undefined> {
  if (query in cache) return cache[query]!.candidate;
  const candidate = await geocode(query);
  cache[query] = { query, candidate, at: new Date().toISOString() };
  // Flushed as we go. A run is a quarter of an hour of deliberately slow,
  // deliberately polite requests, and the first version threw all of them away
  // when the last one was refused.
  if (calls % 10 === 0) saveCache();
  return candidate;
}

/**
 * Walk the query ladder and keep the first answer the gate is willing to show.
 *
 * Rung 0 is the whole address and is the only rung that can earn HIGH. Every
 * rung after it asked about one part of the address, so the answer is the area
 * and not the door, and the gate is told so.
 *
 * A rung that produces something unusable is not a reason to stop: a rejected
 * city centroid on rung 0 says nothing about whether rung 1's locality will
 * resolve. The last unusable result is kept only so that a failure has a reason
 * attached to it in the review file.
 */
async function locate(address: string, districtName?: string) {
  const ladder = geocodeQueries(address, districtName);
  let worst: { query: string; candidate?: GeocodeCandidate; result: GateResult } = {
    query: ladder[0]!,
    result: { status: "UNRESOLVED", note: "the geocoder had nothing for this address or any part of it" },
  };

  for (const [rung, query] of ladder.entries()) {
    if (calls >= limit && !(query in cache)) break;
    const candidate = await lookup(query);
    if (!candidate) continue;
    const result = gradeCandidate({ candidate, sourceAddress: address, districtName, backedOff: rung > 0 });
    if (result.status.startsWith("DERIVED")) return { query, candidate, result };
    worst = { query, candidate, result };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// OFFICE nodes are not only in offices.json. services-compile puts the office a
// journey visits in that journey's bundle, so 165 of the 316 live elsewhere and
// a run over one file would leave half the country unplaced.
const bundles = readdirSync(GRAPH)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({ file, json: JSON.parse(readFileSync(resolve(GRAPH, file), "utf8")) as { nodes?: GraphNode[] } }))
  .filter((b) => b.json.nodes?.some((n) => n.type === "OFFICE"));

const offices = bundles.flatMap((b) => (b.json.nodes ?? []).filter((n) => n.type === "OFFICE").map((node) => ({ node, file: b.file })));
const limit = Number(option("limit") ?? Infinity);

const tally: Record<string, number> = {};
const review: unknown[] = [];
const touched = new Set<string>();
let changed = 0;
let skipped = 0;

// A run that dies halfway must still leave behind everything it learned, so the
// report and the writes below run whatever happens in here.
try {
  await run();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  console.error("Keeping what was resolved before that. Run again to continue.");
}

async function run() {
  for (const { node: office, file } of offices) {
    await one(office, file);
  }
}

async function one(office: GraphNode, file: string) {
  const address = office.metadata?.address;
  if (!address) {
    tally.UNRESOLVED = (tally.UNRESOLVED ?? 0) + 1;
    return;
  }

  // A location is only valid for the address it was derived from. If the
  // address moved, the coordinate is stale whatever its status used to say.
  const hash = addressHash(address);
  if (!flag("recheck") && office.metadata?.location?.sourceAddressHash === hash) {
    tally[office.metadata.location.status] = (tally[office.metadata.location.status] ?? 0) + 1;
    skipped++;
    return;
  }
  if (calls >= limit) throw new Error(`Stopped at the --limit of ${limit} network call(s).`);

  const districtName = jurisdictionNames.get(office.jurisdictionId ?? "");
  const { query, candidate, result } = await locate(address, districtName);

  // §42 offices publish more than one address. If the alternates land somewhere
  // else entirely, one of the sources is wrong about where this office is, and
  // no confidence in the geocoder fixes that.
  let verdict = result;
  const alternates = office.metadata?.conflictingAddresses ?? [];
  if (candidate && result.status.startsWith("DERIVED") && alternates.length) {
    const points = [candidate];
    for (const alt of alternates) {
      if (calls >= limit) break;
      const other = await locate(alt, districtName);
      if (other.candidate && other.result.status.startsWith("DERIVED")) points.push(other.candidate);
    }
    const reconciled = reconcileConflict(points);
    if (reconciled) verdict = { status: reconciled.status, note: `${result.note}; ${reconciled.note}` };
  }

  tally[verdict.status] = (tally[verdict.status] ?? 0) + 1;

  const location: DerivedLocation | undefined = candidate && {
    latitude: round(candidate.latitude),
    longitude: round(candidate.longitude),
    provenance: "DERIVED",
    provider: "OSM_NOMINATIM",
    status: verdict.status,
    ...(candidate.addressType ? { precision: candidate.addressType } : {}),
    geocodedAt: new Date().toISOString().slice(0, 10),
    sourceAddressHash: hash,
    query,
    note: verdict.note,
  };

  if (verdict.status === "REVIEW_REQUIRED" || verdict.status === "REJECTED") {
    review.push({
      id: office.id,
      name: office.name,
      jurisdictionId: office.jurisdictionId,
      address,
      query,
      status: verdict.status,
      why: verdict.note,
      geocoderSaid: candidate?.displayName,
      ...(candidate ? { latitude: round(candidate.latitude), longitude: round(candidate.longitude) } : {}),
    });
  }

  if (location) {
    office.metadata = { ...office.metadata, location };
    touched.add(file);
    changed++;
  }
  console.log(`  ${pad(verdict.status)} ${office.name} — ${verdict.note}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const usable = (tally.DERIVED_HIGH ?? 0) + (tally.DERIVED_MEDIUM ?? 0);
console.log(`\n${offices.length} office(s), ${calls} network call(s), ${skipped} already current`);
for (const status of ["DERIVED_HIGH", "DERIVED_MEDIUM", "REVIEW_REQUIRED", "REJECTED", "UNRESOLVED"]) {
  console.log(`  ${String(tally[status] ?? 0).padStart(4)}  ${status}`);
}
console.log(`  ${usable} office(s) may be drawn on a map, ${offices.length - usable} show an address and no pin`);

if (flag("dry")) {
  console.log("\n--dry, nothing written.");
  process.exit(0);
}

saveCache();

for (const { file, json } of bundles) {
  if (!touched.has(file)) continue;
  writeFileSync(resolve(GRAPH, file), JSON.stringify(json, null, 2) + "\n");
}
if (changed) console.log(`\nWrote ${changed} location(s) across ${touched.size} bundle(s).`);
if (review.length) {
  mkdirSync(dirname(REVIEW), { recursive: true });
  writeFileSync(REVIEW, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), count: review.length, offices: review }, null, 2) + "\n");
  console.log(`${review.length} office(s) need a human. See artifacts/location-review.json.`);
}
console.log("Run pnpm bundles:build, then pnpm graph:validate.");

/** Six decimals is ~10cm. Anything past that is noise pretending to be precision. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function pad(status: string): string {
  return status.padEnd(16);
}
