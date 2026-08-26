import { loadGraph } from "../data/providers";
import type { NodeType } from "../types";

const data = loadGraph();

const count = (type: NodeType) => data.nodes.filter((n) => n.type === type).length;
const verifiedEdges = data.edges.filter((e) => e.verificationStatus === "VERIFIED").length;
const conflicts = [...data.nodes, ...data.edges].filter(
  (x) => ("verificationStatus" in x && x.verificationStatus === "CONFLICTING") ||
    x.sources?.some((s) => s.verificationStatus === "CONFLICTING"),
).length;

const rows: [string, number][] = [
  ["Jurisdictions", data.jurisdictions.length],
  ["Services", count("SERVICE")],
  ["Documents", count("DOCUMENT") + count("DOCUMENT_GROUP")],
  ["Actions", count("ACTION") + count("VERIFICATION") + count("PAYMENT")],
  ["Eligibility rules", count("ELIGIBILITY")],
  ["Portals", count("PORTAL")],
  ["Mobile apps", count("MOBILE_APP")],
  ["Offices", count("OFFICE")],
  ["Departments", count("DEPARTMENT")],
  ["Helplines", count("HELPLINE") + count("GRIEVANCE_CHANNEL")],
  ["Edges", data.edges.length],
  ["Verified edges", verifiedEdges],
  ["Requirement groups", data.requirementGroups.length],
  ["Sources", data.sources.length],
  ["Conflicts", conflicts],
  ["Questions", data.questions.length],
];

const width = Math.max(...rows.map(([label]) => label.length));
for (const [label, value] of rows) console.log(`${label.padEnd(width)}  ${value}`);
