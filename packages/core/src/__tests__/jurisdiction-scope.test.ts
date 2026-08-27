import { describe, expect, it } from "vitest";
import { GoalOutOfJurisdictionError, compileJourney } from "../journey";
import type { GraphData, GraphEdge, GraphNode, Jurisdiction } from "../types";

/**
 * A journey never quotes another district's counter.
 *
 * Both halves of this were live. The corpus holds one municipal corporation's
 * property tax desk and no other, so "property tax" resolved to Jamnagar's
 * service for every citizen in Gujarat and handed an Ahmedabad applicant a
 * Jamnagar address. And a state wide service links the offices of whichever
 * districts happened to publish a page about it, so an income certificate in
 * Ahmedabad listed a Jamnagar counter beside the right one.
 *
 * Names copied from the real graph on purpose: the point is the shape of the
 * data that broke, not an invented worst case.
 */

const jurisdictions: Jurisdiction[] = [
  { id: "IN", level: "COUNTRY", name: "India" },
  { id: "IN-GJ", parentId: "IN", level: "STATE", name: "Gujarat" },
  { id: "IN-GJ-AHMEDABAD", parentId: "IN-GJ", level: "DISTRICT", name: "Ahmedabad" },
  { id: "IN-GJ-JAMNAGAR", parentId: "IN-GJ", level: "DISTRICT", name: "Jamnagar" },
];

const node = (id: string, type: GraphNode["type"], name: string, jurisdictionId?: string): GraphNode => ({
  id,
  type,
  name,
  jurisdictionId,
});

const edge = (from: string, to: string, type: GraphEdge["type"]): GraphEdge => ({
  id: `${from}|${type}|${to}`,
  from,
  to,
  type,
  verificationStatus: "VERIFIED",
});

const data: GraphData = {
  jurisdictions,
  nodes: [
    node("service:property_tax", "SERVICE", "property_tax", "IN-GJ-JAMNAGAR"),
    node("office:jamnagar_municipal_corporation", "OFFICE", "Jamnagar Municipal Corporation", "IN-GJ-JAMNAGAR"),
    node("service:income_certificate", "SERVICE", "income_certificate", "IN-GJ"),
    node("office:mamlatdar_ahmedabad", "OFFICE", "Mamlatdar Office, Ahmedabad", "IN-GJ-AHMEDABAD"),
    node("office:mamlatdar_jamnagar", "OFFICE", "Mamlatdar Office, Jamnagar", "IN-GJ-JAMNAGAR"),
    node("office:collectorate_gujarat", "OFFICE", "Collectorate", "IN-GJ"),
  ],
  edges: [
    edge("service:property_tax", "office:jamnagar_municipal_corporation", "VISIT_AT"),
    edge("service:income_certificate", "office:mamlatdar_ahmedabad", "VISIT_AT"),
    edge("service:income_certificate", "office:mamlatdar_jamnagar", "VISIT_AT"),
    edge("service:income_certificate", "office:collectorate_gujarat", "VISIT_AT"),
  ],
  requirementGroups: [],
  sources: [],
  questions: [],
};

const from = (district?: string) => ({ country: "India", state: "Gujarat", district });
const officesFor = (goal: string, district?: string) =>
  compileJourney(data, { goal, jurisdiction: from(district) }).offices.map((o) => o.name);

describe("a journey stays inside the district it was asked from", () => {
  it("refuses a goal only another district publishes, and says whose it is", () => {
    expect(() => officesFor("property_tax", "Ahmedabad")).toThrow(GoalOutOfJurisdictionError);
    expect(() => officesFor("property_tax", "Ahmedabad")).toThrow(/published for Jamnagar/);
  });

  it("still compiles that goal for the district that does publish it", () => {
    expect(officesFor("property_tax", "Jamnagar")).toEqual(["Jamnagar Municipal Corporation"]);
  });

  // The state wide service is the right service everywhere. Only its counters
  // are local, and only the local ones may be shown.
  it("drops another district's office off a state wide service", () => {
    expect(officesFor("income_certificate", "Ahmedabad")).toEqual(["Mamlatdar Office, Ahmedabad", "Collectorate"]);
  });

  // No district named means no district ruled out: the citizen asked about
  // Gujarat and every office in Gujarat is an honest answer.
  it("keeps every district's office when the citizen named no district", () => {
    expect(officesFor("income_certificate")).toHaveLength(3);
    expect(officesFor("property_tax")).toEqual(["Jamnagar Municipal Corporation"]);
  });
});
