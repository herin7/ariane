import { describe, expect, it } from "vitest";
import {
  addressHash,
  formatCrowKm,
  formatDuration,
  formatRoutedKm,
  geocodeQueries,
  geocodeQuery,
  gradeCandidate,
  haversineKm,
  locationIsUsable,
  pincodeOf,
  rankByDistance,
  rankByJurisdiction,
  reconcileConflict,
  type DerivedLocation,
  type GeocodeCandidate,
  type OfficeRef,
} from "../index";

/**
 * The gate between "a geocoder said something" and "a citizen is shown a pin".
 *
 * Every case here is a way a free geocoder can be confidently wrong about an
 * Indian government address. The address itself is proven by a source; the
 * coordinate never is, so these are the rules that decide when it is allowed
 * on screen at all.
 */

const AHMEDABAD = { latitude: 23.0225, longitude: 72.5714 };

function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    latitude: 23.0301,
    longitude: 72.5801,
    displayName: "Collector Office, Lal Darwaja, Ahmedabad, Gujarat, 380001, India",
    addressType: "building",
    address: { road: "Lal Darwaja", state_district: "Ahmedabad", state: "Gujarat", postcode: "380001" },
    boundingBox: [23.029, 23.031, 72.579, 72.581],
    ...over,
  };
}

function grade(over: Partial<GeocodeCandidate> = {}, sourceAddress = "Collector Office, Lal Darwaja, Ahmedabad - 380001") {
  return gradeCandidate({ candidate: candidate(over), sourceAddress, districtName: "Ahmedabad" });
}

describe("the query we send, built beside the address and never over it", () => {
  it("adds the administrative context a district portal never bothered to print", () => {
    expect(geocodeQuery("Mamlatdar Office, Dahod", "Dahod")).toBe("Mamlatdar Office, Dahod, Gujarat, India");
  });

  it("does not say Gujarat twice when the office is scoped to the state", () => {
    expect(geocodeQuery("Aranya Bhavan, Sector 10A, Gandhinagar, Gujarat", "Gujarat")).toBe("Aranya Bhavan, Sector 10A, Gandhinagar, Gujarat, India");
  });

  it("moves an inline pincode to the end instead of saying it twice", () => {
    const query = geocodeQuery("RTO, Subhash Bridge, Ahmedabad - 380027", "Ahmedabad");
    expect(query).toBe("RTO, Subhash Bridge, Ahmedabad, Gujarat, India, 380027");
    expect(query.match(/380027/gu)).toHaveLength(1);
  });

  it("leaves Gujarati script alone, because that is the form OSM indexes", () => {
    expect(geocodeQuery("મામલતદાર કચેરી, વડોદરા", "Vadodara")).toContain("મામલતદાર કચેરી");
  });

  it("finds a pincode with no word boundary in front of it", () => {
    expect(pincodeOf("Ahmedabad-380027")).toBe("380027");
    expect(pincodeOf("Phone 07926851234, no pincode here")).toBeUndefined();
  });

  // Measured: asking Nominatim for any of these addresses whole returns
  // nothing, 125 times out of 125. It matches names it has indexed, and a
  // government address is mostly floors, wings and landmark relations.
  it("falls back to the parts of the address a gazetteer could plausibly know", () => {
    const ladder = geocodeQueries("2nd Floor, ‘D’ Block, M.S.Building, Lal Darwaja, Ahmedabad-1", "Ahmedabad");
    expect(ladder[0]).toBe("2nd Floor, ‘D’ Block, M.S.Building, Lal Darwaja, Ahmedabad-1, Ahmedabad, Gujarat, India");
    expect(ladder.slice(1)).toContain("Lal Darwaja, Ahmedabad, Gujarat, India");
  });

  it("does not waste a request a second on a floor, a wing or a nearby landmark", () => {
    const ladder = geocodeQueries("First Floor, F-1 Wing, Block-3, Karmyogi Bhavan, Sector-10-A, Gandhinagar", "Gandhinagar");
    // The floor, the wing and the block are gone. The two names a gazetteer
    // could plausibly hold are what is left, specific one first.
    expect(ladder.slice(1)).toEqual(["Karmyogi Bhavan, Gandhinagar, Gujarat, India", "Sector-10-A, Gandhinagar, Gujarat, India"]);
  });

  it("asks the specific parts before the general ones, so the door beats the neighbourhood", () => {
    const ladder = geocodeQueries("Alkapuri Pologround, Alkapuri, Himatnagar, Sabarkantha, Gujarat - 383001", "Sabarkantha");
    expect(ladder.slice(1).map((q) => q.split(",")[0])).toEqual(["Alkapuri Pologround", "Alkapuri", "Himatnagar"]);
  });

  it("never repeats a rung, so a one-segment address costs one request", () => {
    const ladder = geocodeQueries("Gandhinagar", "Gandhinagar");
    expect(ladder).toEqual(["Gandhinagar, Gujarat, India"]);
  });

  it("hashes an address stably, and differently when a character moves", () => {
    expect(addressHash("Lal Darwaja, Ahmedabad")).toBe(addressHash("Lal Darwaja, Ahmedabad"));
    expect(addressHash("Lal Darwaja, Ahmedabad")).not.toBe(addressHash("Lal Darwaja, Ahmedabed"));
  });
});

describe("the gate", () => {
  it("accepts a building on a named road in the right district", () => {
    const result = grade();
    expect(result.status).toBe("DERIVED_HIGH");
    expect(locationIsUsable({ ...({} as DerivedLocation), status: result.status })).toBe(true);
  });

  // The failure this whole file exists for: Nominatim cannot find the street,
  // so it answers with the middle of the city and a plausible looking result.
  it("rejects a city centroid, which is the dangerous hit and not a miss", () => {
    expect(grade({ addressType: "city", address: { state_district: "Ahmedabad", state: "Gujarat" } }).status).toBe("REJECTED");
  });

  it("rejects anything whose bounding box is bigger than a neighbourhood", () => {
    const wide = grade({ addressType: "suburb", boundingBox: [22.9, 23.2, 72.4, 72.8] });
    expect(wide.status).toBe("REJECTED");
    expect(wide.note).toMatch(/too coarse/u);
  });

  it("rejects another state, because Dahod also exists elsewhere", () => {
    expect(grade({ address: { state: "Rajasthan", state_district: "Dahod" } }).status).toBe("REJECTED");
  });

  it("rejects a swapped lat/lng instead of putting the office in the sea", () => {
    expect(grade({ latitude: 72.5714, longitude: 23.0225 }).status).toBe("REJECTED");
  });

  it("holds a pincode disagreement for review rather than guessing which is right", () => {
    const result = grade({ address: { ...candidate().address, postcode: "380015" } });
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.note).toContain("380001");
  });

  it("holds a district it cannot confirm, even when the coordinate looks fine", () => {
    expect(grade({ displayName: "Some Road, Surat, Gujarat", address: { road: "Some Road", state_district: "Surat", state: "Gujarat" } }).status).toBe(
      "REVIEW_REQUIRED",
    );
  });

  // "Lal Darwaja, Ahmedabad" resolves to a bus stop of that name. Nominatim
  // calls it an amenity and is right. It is still not the office.
  it("caps a backed-off answer at medium however precise the geocoder claims it was", () => {
    const result = gradeCandidate({ candidate: candidate(), sourceAddress: "irrelevant", districtName: "Ahmedabad", backedOff: true });
    expect(result.status).toBe("DERIVED_MEDIUM");
    expect(result.note).toMatch(/not the door/u);
  });

  it("calls a locality level hit medium, not high, so nobody reads it as the door", () => {
    const result = grade({ addressType: "village", address: { village: "Bhiloda", state_district: "Ahmedabad", state: "Gujarat" } });
    expect(result.status).toBe("DERIVED_MEDIUM");
    expect(result.note).toMatch(/not the building/u);
  });

  it("only lets the top two statuses near a map", () => {
    const at = (status: DerivedLocation["status"]) => locationIsUsable({ ...({} as DerivedLocation), status });
    expect([at("DERIVED_HIGH"), at("DERIVED_MEDIUM")]).toEqual([true, true]);
    expect([at("REVIEW_REQUIRED"), at("REJECTED"), at("UNRESOLVED")]).toEqual([false, false, false]);
    expect(locationIsUsable(undefined)).toBe(false);
  });
});

describe("when two sources disagree about where an office is", () => {
  it("keeps the pin when they disagree by a few streets", () => {
    const result = reconcileConflict([AHMEDABAD, { latitude: 23.0301, longitude: 72.5801 }]);
    expect(result?.status).toBe("DERIVED_MEDIUM");
  });

  it("sends nobody anywhere when they disagree by a city", () => {
    const result = reconcileConflict([AHMEDABAD, { latitude: 21.1702, longitude: 72.8311 }]);
    expect(result?.status).toBe("REVIEW_REQUIRED");
    expect(result?.note).toMatch(/apart/u);
  });
});

describe("distance", () => {
  it("measures a known Gujarat pair against its real distance", () => {
    // Ahmedabad to Surat is about 230km as the crow flies.
    expect(haversineKm(AHMEDABAD, { latitude: 21.1702, longitude: 72.8311 })).toBeGreaterThan(200);
    expect(haversineKm(AHMEDABAD, { latitude: 21.1702, longitude: 72.8311 })).toBeLessThan(240);
  });

  it("is zero to itself and symmetric", () => {
    const surat = { latitude: 21.1702, longitude: 72.8311 };
    expect(haversineKm(AHMEDABAD, AHMEDABAD)).toBe(0);
    expect(haversineKm(AHMEDABAD, surat)).toBeCloseTo(haversineKm(surat, AHMEDABAD), 9);
  });

  it("says a crow distance with a tilde and a routed one without, because they are different promises", () => {
    expect(formatCrowKm(4.13)).toBe("~4.1 km");
    expect(formatCrowKm(0.42)).toBe("~400 m");
    expect(formatRoutedKm(4.13)).toBe("4.1 km");
    expect(formatDuration(90 * 60)).toBe("1 hr 30 min");
  });
});

describe("ranking the offices on a journey", () => {
  const office = (name: string, location?: Partial<DerivedLocation>, jurisdictionId?: string): OfficeRef =>
    ({
      nodeId: `office:${name}`,
      name,
      jurisdictionId,
      location: location && ({ latitude: 0, longitude: 0, status: "DERIVED_HIGH", ...location } as DerivedLocation),
    }) as OfficeRef;

  const near = office("Near", { latitude: 23.03, longitude: 72.58 });
  const far = office("Far", { latitude: 21.17, longitude: 72.83 });
  const unplaced = office("Unplaced");
  const rejected = office("Rejected", { latitude: 23.03, longitude: 72.58, status: "REJECTED" });

  it("puts the nearest first and caps the list", () => {
    const ranked = rankByDistance([far, near], AHMEDABAD, 1);
    expect(ranked.map((r) => r.office.name)).toEqual(["Near"]);
    expect(ranked[0]!.crowKm).toBeLessThan(3);
  });

  // An office we could not place is not far away, it is unplaced. Sorting it
  // to the bottom would be a claim about its distance that nobody made.
  it("drops offices with no usable coordinate out of the ranking entirely", () => {
    expect(rankByDistance([unplaced, rejected, near], AHMEDABAD).map((r) => r.office.name)).toEqual(["Near"]);
  });

  it("falls back to the jurisdiction the citizen asked about when there is no position", () => {
    const chain = ["IN-GJ-AHMEDABAD", "IN-GJ", "IN"];
    const offices = [office("State", undefined, "IN-GJ"), office("Local", undefined, "IN-GJ-AHMEDABAD"), office("Elsewhere", undefined, "IN-GJ-SURAT")];
    expect(rankByJurisdiction(offices, chain).map((o) => o.name)).toEqual(["Local", "State", "Elsewhere"]);
  });
});
