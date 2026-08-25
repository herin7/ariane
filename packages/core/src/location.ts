import type { DerivedLocation, LocationStatus, OfficeRef } from "./types";
import { locationIsUsable } from "./types";

/**
 * Everything about turning a published address into a point on a map, minus
 * the network.
 *
 * The geocoder lives in `cli/geocode.ts` and calls into here for every decision
 * it makes, so the rules that accept or reject a coordinate are testable
 * without a socket and are the same rules the runtime uses to decide whether it
 * may draw a pin.
 *
 * The invariant this file exists to hold:
 *
 *   SOURCE PROVES THE ADDRESS. LOCATION PROVIDER DERIVES THE COORDINATE.
 *
 * A geocoder that cannot find a street does not fail. It returns the centre of
 * the city and a confident looking score, and that centroid renders as a pin
 * identical to a real one. Everything below is built around refusing that pin.
 */

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * Government addresses are quoted verbatim and are not tidied up, so the
 * string we send a geocoder is built beside the source rather than over it.
 *
 * The address itself is evidence and is never rewritten. This produces a
 * separate `geocodeQuery` with the administrative context the source page took
 * for granted, because a page on a Gujarat district portal has no reason to
 * print "Gujarat, India" beside an office it considers local.
 */
export function geocodeQuery(address: string, districtName?: string): string {
  // Gujarati script is left exactly as it is. Nominatim indexes OSM's local
  // name tags, so transliterating would throw away the one form that matches.
  return context(segmentsOf(address), districtName, pincodeOf(address));
}

/**
 * The same address, asked several ways, most specific first.
 *
 * Measured against the real corpus, Nominatim answers almost none of these
 * addresses whole. It is a gazetteer, not an address parser: it matches names
 * it has indexed, and "2nd Floor, 'D' Block, M.S.Building, Lal Darwaja,
 * Ahmedabad-1" contains exactly one such name. Asking for the whole string
 * returns nothing, and nothing is what 125 of 125 offices got.
 *
 * So each segment is also asked on its own, in the order Indian addresses are
 * written, which runs from the door outward. The first rung the gate accepts
 * wins, and because the specific segments are asked first, an answer for the
 * building beats an answer for the neighbourhood it stands in.
 *
 * The caller must treat everything after rung 0 as a locality-level answer, no
 * matter how precise the geocoder claims it was. "Lal Darwaja" resolves to a
 * bus stop of that name, and a bus stop is an excellent description of which
 * part of Ahmedabad the office is in and a lie about where its door is.
 */
export function geocodeQueries(address: string, districtName?: string, limit = 3): string[] {
  const pin = pincodeOf(address);
  const segments = segmentsOf(address);
  const skip = new Set([districtName ?? "", "Gujarat", "India"].filter(Boolean).map(normalise));

  const backoff = segments
    .filter((segment) => !NOISE.test(segment))
    .filter((segment) => {
      const key = normalise(segment);
      // Too short to be a place name, or a name we are already appending.
      return key.length >= 4 && !skip.has(key) && !/^\d+$/u.test(key);
    })
    .slice(0, limit)
    .map((segment) => context([segment], districtName, undefined));

  return [...new Set([context(segments, districtName, pin), ...backoff])];
}

/** Comma separated parts of an address, tidied, with a trailing pincode removed. */
function segmentsOf(address: string): string[] {
  return address
    .replace(/[-–—]?\s*\b\d{6}\b\.?\s*$/u, "")
    .split(/\s*[,\n]\s*/u)
    .map((segment) => segment.replace(/\s{2,}/gu, " ").replace(/^[.,\s]+|[.,\s]+$/gu, ""))
    .filter(Boolean);
}

/** The administrative context a district portal never bothered to print. */
function context(parts: string[], districtName: string | undefined, pin: string | undefined): string {
  const out: string[] = [];
  for (const part of [...parts, districtName, "Gujarat", "India", pin]) {
    if (!part) continue;
    // "Gujarat, Gujarat" when the office is scoped to the state rather than a
    // district, and "Ahmedabad, Ahmedabad" when the address already said it.
    if (out.some((seen) => normalise(seen) === normalise(part))) continue;
    out.push(part);
  }
  return out.join(", ");
}

/**
 * Segments that are never a place: which floor, which wing, whose office, and
 * the "near the big landmark" that Indian addresses use instead of a number.
 * A geocoder cannot index any of them, and asking wastes a request a second.
 */
const NOISE =
  /^(office of|o\/o)\b|\b(floor|flr|block|wing|room|cabin|campus|building)\b|^(near|nr\.?|opp\.?|opposite|behind|beside|b\/h|above|below)\b|^["'‘’]?[\p{L}0-9-]{1,3}["'‘’]?$|^\d+(st|nd|rd|th)?\b/iu;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The six digit pincode in an address, if it printed one. */
export function pincodeOf(address: string): string | undefined {
  // Not \b on the left: "Ahmedabad-380027" has no word boundary before the
  // digits, and that hyphenated form is the common one in this corpus.
  const hit = address.match(/(?<!\d)(\d{6})(?!\d)/u);
  return hit?.[1];
}

/**
 * Stable id for the exact address a coordinate was derived from.
 *
 * Cheap FNV-1a rather than a crypto hash, because this is a cache key and a
 * change detector, not a security boundary, and this module has to stay
 * importable in a browser bundle with no dependencies behind it.
 */
export function addressHash(address: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < address.length; i++) {
    hash ^= address.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The parts of a Nominatim result the gate is allowed to look at. */
export interface GeocodeCandidate {
  latitude: number;
  longitude: number;
  displayName: string;
  /** Nominatim's `addresstype`: building, road, suburb, city, state ... */
  addressType?: string;
  /** Nominatim's structured `address` object, keys as it sends them. */
  address?: Record<string, string | undefined>;
  /** south, north, west, east. Nominatim sends these as strings. */
  boundingBox?: [number, number, number, number];
}

export interface GateInput {
  candidate: GeocodeCandidate;
  /** The verbatim address, for the pincode check. */
  sourceAddress: string;
  /** The office's own district, from its jurisdiction. */
  districtName?: string;
  /** The state every office in this corpus should land in. */
  expectedState?: string;
  /**
   * True when the query was not the whole address but one segment of it.
   *
   * A landmark query answers with a landmark. Nominatim will call it a
   * building and mean it, and it is still not the office, so a backed-off
   * answer is capped at locality precision however confident the geocoder was.
   */
  backedOff?: boolean;
}

export interface GateResult {
  status: LocationStatus;
  note: string;
}

/**
 * Anything at or above this level is an administrative area, and a coordinate
 * for one is the middle of it. A citizen sent to the centroid of Ahmedabad is
 * worse off than a citizen shown an address and no map at all.
 */
const CENTROID_TYPES = new Set([
  "country",
  "state",
  "state_district",
  "county",
  "region",
  "province",
  "district",
  "city",
  "municipality",
  "town",
  "postcode",
  "administrative",
]);

/** Precise enough that the pin is the building or the street it is on. */
const PRECISE_TYPES = new Set([
  "building",
  "house",
  "amenity",
  "office",
  "road",
  "residential",
  "commercial",
  "government",
  "public_building",
  "townhall",
  "shop",
  "railway",
  // Photon's own vocabulary. It types a building as "house" and a way as
  // "street" where Nominatim says "building" and "road".
  "street",
]);

/**
 * Roughly 11km at this latitude. A bounding box wider than this is a
 * neighbourhood at best and a district at worst, whatever the type says.
 */
const MAX_SPAN_DEGREES = 0.1;

export function gradeCandidate({
  candidate,
  sourceAddress,
  districtName,
  expectedState = "Gujarat",
  backedOff = false,
}: GateInput): GateResult {
  const address = candidate.address ?? {};
  const haystack = `${candidate.displayName} ${Object.values(address).filter(Boolean).join(" ")}`.toLowerCase();

  // --- the coordinate has to be a coordinate ------------------------------
  if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
    return { status: "REJECTED", note: "geocoder returned a non-numeric coordinate" };
  }
  // India's bounding box, loosely. Catches swapped lat/lng, which is the
  // classic way this goes wrong and lands every office in the Indian Ocean.
  if (candidate.latitude < 6 || candidate.latitude > 38 || candidate.longitude < 66 || candidate.longitude > 98) {
    return { status: "REJECTED", note: "coordinate falls outside India" };
  }

  // --- right state --------------------------------------------------------
  const state = address.state ?? "";
  if (state && !looseMatch(state, expectedState)) {
    return { status: "REJECTED", note: `resolved to ${state}, expected ${expectedState}` };
  }
  if (!state && !haystack.includes(expectedState.toLowerCase())) {
    return { status: "REVIEW_REQUIRED", note: `nothing in the result confirms ${expectedState}` };
  }

  // --- not the middle of somewhere ----------------------------------------
  const type = (candidate.addressType ?? "").toLowerCase();
  if (CENTROID_TYPES.has(type)) {
    return { status: "REJECTED", note: `resolved only to the ${type} centroid` };
  }
  const span = spanOf(candidate.boundingBox);
  if (span !== undefined && span > MAX_SPAN_DEGREES) {
    return { status: "REJECTED", note: `result covers ~${Math.round(span * 111)}km, too coarse to be a building` };
  }

  // --- right pincode ------------------------------------------------------
  const wanted = pincodeOf(sourceAddress);
  const got = address.postcode;
  if (wanted && got && wanted !== got.replace(/\s/gu, "")) {
    return { status: "REVIEW_REQUIRED", note: `address says ${wanted}, geocoder says ${got}` };
  }

  // --- right district -----------------------------------------------------
  // Nominatim spreads the district across several keys depending on whether
  // the place is inside a municipal corporation, so all of them are candidates.
  const districtish = [address.state_district, address.county, address.city, address.town, address.suburb]
    .filter(Boolean)
    .join(" ");
  const districtConfirmed = districtName
    ? looseMatch(districtish, districtName) || haystack.includes(districtName.toLowerCase())
    : false;

  if (districtName && !districtConfirmed) {
    return { status: "REVIEW_REQUIRED", note: `expected ${districtName}, result says ${districtish || "nothing"}` };
  }

  // --- how precise --------------------------------------------------------
  const pinpoint = PRECISE_TYPES.has(type) || Boolean(address.road) || Boolean(address.house_number);
  if (backedOff) {
    return { status: "DERIVED_MEDIUM", note: `matched on one part of the address (${type || "place"}), so this is the area and not the door` };
  }
  if (pinpoint && (districtConfirmed || !districtName)) {
    return { status: "DERIVED_HIGH", note: `${type || "place"} match${wanted && got ? ", pincode agrees" : ""}` };
  }

  return { status: "DERIVED_MEDIUM", note: `locality level match (${type || "unspecified"}), not the building` };
}

function spanOf(box: GeocodeCandidate["boundingBox"]): number | undefined {
  if (!box) return undefined;
  const [south, north, west, east] = box;
  if (![south, north, west, east].every(Number.isFinite)) return undefined;
  return Math.max(Math.abs(north - south), Math.abs(east - west));
}

/** Government pages spell districts several ways. Compare on letters only. */
function looseMatch(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z઀-૿]/gu, "");
  const left = key(a);
  const right = key(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

// ---------------------------------------------------------------------------
// Conflicting addresses
// ---------------------------------------------------------------------------

/**
 * 26 offices have more than one address across their sources.
 *
 * If the alternates land within a few streets of each other the disagreement
 * is cosmetic and the pin survives, carrying the conflict in its note. If they
 * land in different parts of the state then one of the sources is wrong about
 * where the office is, and no amount of confidence in the geocoder fixes that,
 * so nobody gets sent anywhere.
 */
export const CONFLICT_TOLERANCE_KM = 2;

export function reconcileConflict(points: { latitude: number; longitude: number }[]): GateResult | undefined {
  if (points.length < 2) return undefined;
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      worst = Math.max(worst, haversineKm(points[i]!, points[j]!));
    }
  }
  if (worst <= CONFLICT_TOLERANCE_KM) {
    return { status: "DERIVED_MEDIUM", note: `sources disagree on the address but agree within ${worst.toFixed(1)}km` };
  }
  return { status: "REVIEW_REQUIRED", note: `sources place this office ${worst.toFixed(1)}km apart` };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export interface Point {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Straight line distance. Coarse ranking only.
 *
 * This is what decides which two or three offices are worth asking a routing
 * server about; it is never what a citizen is shown as a travel distance,
 * because the crow does not have to cross the Sabarmati.
 */
export function haversineKm(a: Point, b: Point): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export interface RankedOffice {
  office: OfficeRef;
  location: DerivedLocation;
  /** Straight line, kilometres. Not a travel distance. */
  crowKm: number;
}

/**
 * The offices on this journey that we are willing to put on a map, nearest
 * first.
 *
 * Only offices whose coordinate cleared the gate are candidates: an office we
 * could not place is not "far away", it is unplaced, and dropping it out of a
 * distance ranking is the only honest thing to do with it. The caller still
 * shows it, with its address and no distance.
 */
export function rankByDistance(offices: OfficeRef[], from: Point, limit = 3): RankedOffice[] {
  return offices
    .flatMap((office) =>
      locationIsUsable(office.location) ? [{ office, location: office.location, crowKm: haversineKm(from, office.location) }] : [],
    )
    .sort((a, b) => a.crowKm - b.crowKm)
    .slice(0, limit);
}

/**
 * With no permission to know where the citizen is, the graph still knows which
 * district they asked about. Offices in it first, everything else after, and
 * the screen says "in Ahmedabad" rather than "nearest".
 */
export function rankByJurisdiction(offices: OfficeRef[], jurisdictionChain: string[]): OfficeRef[] {
  const rank = (office: OfficeRef) => {
    const at = office.jurisdictionId ? jurisdictionChain.indexOf(office.jurisdictionId) : -1;
    // Most specific match first; unscoped and unmatched offices sort last.
    return at === -1 ? jurisdictionChain.length + 1 : at;
  };
  return [...offices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * How a distance is allowed to be said.
 *
 * A routed distance came off a road network and gets a decimal. A crow flown
 * one is an estimate and gets a tilde and no false precision, because "4.1 km"
 * and "~4 km" are different promises and only one of them was measured.
 */
export function formatCrowKm(km: number): string {
  if (km < 1) return `~${Math.round(km * 10) * 100} m`;
  return `~${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatRoutedKm(km: number): string {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}
