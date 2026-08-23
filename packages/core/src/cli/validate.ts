import { loadGraph, validateGraph } from "../data/index";

const issues = validateGraph(loadGraph());
const errors = issues.filter((i) => i.severity === "ERROR");
const warnings = issues.filter((i) => i.severity === "WARNING");

for (const issue of [...errors, ...warnings]) {
  console.log(`${issue.severity === "ERROR" ? "ERROR  " : "warning"}  [${issue.code}] ${issue.message}`);
}

console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) process.exit(1);
