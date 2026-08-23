import { loadGraph } from "../data/index";
import { compileJourney } from "../journey";
import { officeLine, type CompiledJourney, type DocumentRequirement, type Facts } from "../types";

/**
 * Compile a journey from the command line. This is the checkpoint the whole
 * engine is graded against, so it prints the shape a citizen would see rather
 * than a JSON blob.
 *
 *   pnpm journey:test driving_licence --state Gujarat --district Ahmedabad \
 *     --answers age=25,vehicle_class=non_transport --have document:learner_licence
 */

const argv = process.argv.slice(2);
const goal = argv.find((a) => !a.startsWith("--")) ?? "driving_licence";

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

const list = (name: string) => (flag(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const answers: Facts = {};
for (const pair of list("answers")) {
  const [key, ...rest] = pair.split("=");
  if (!key) continue;
  const raw = rest.join("=");
  answers[key] = raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}

const journey = compileJourney(loadGraph(), {
  goal,
  jurisdiction: {
    country: flag("country") ?? "India",
    state: flag("state") ?? "Gujarat",
    district: flag("district"),
  },
  citizen: { documents: list("have"), completedServices: list("done"), answers },
});

print(journey);

function print(j: CompiledJourney): void {
  const rule = (label: string) => console.log(`\n${label}\n${"-".repeat(label.length)}`);

  console.log(`${j.goalName}  (${j.jurisdiction.name})`);
  console.log(
    `${j.summary.stepsRemaining} steps left, ${j.summary.documentsToPrepareCount} documents to prepare, ` +
      `${j.summary.documentsReadyCount} ready, ${j.summary.physicalVisits} office visit(s), ` +
      `${j.summary.blockerCount} blocker(s)`,
  );

  if (j.outstandingQuestions.length) {
    rule("We still need to ask");
    for (const q of j.outstandingQuestions) {
      console.log(`  ? ${q.label}  [${q.field}]`);
      console.log(`      changes: ${q.affects.join(", ")}`);
    }
  }

  rule("Your path");
  for (const step of j.orderedSteps) {
    const state = step.state === "READY" ? "" : `  (${step.state})`;
    console.log(`\n  ${step.order}. ${step.title}${state}`);
    if (step.officialName && step.officialName !== step.title) console.log(`     officially: ${step.officialName}`);
    if (step.whatToDo) console.log(`     do: ${step.whatToDo}`);
    if (step.expectedOutput) console.log(`     you get: ${step.expectedOutput}`);
    if (step.fee) console.log(`     fee: ${step.fee}`);
    if (step.timeline) console.log(`     takes: ${step.timeline}`);
    if (step.formNumber) console.log(`     form: ${step.formNumber}`);
    for (const d of step.documentsNeeded) console.log(`     needs: ${describe(d)}`);
    for (const d of step.documentsReady) console.log(`     have: ${d.name}`);
    for (const c of step.channels) console.log(`     ${c.via.toLowerCase()}: ${c.name} ${c.url ?? ""}`);
    for (const o of step.offices) console.log(`     visit: ${officeLine(o)}`);
    for (const b of step.blockers) console.log(`     blocked: ${b.title} [${b.actor}] ${b.reason}`);
    console.log(`     sources: ${step.sources.map((s) => s.source.url).join(", ") || "none yet"}`);
  }

  if (j.warnings.length) {
    rule("Warnings");
    for (const w of j.warnings) console.log(`  ! ${w}`);
  }

  rule("How we worked this out");
  for (const t of j.trace) console.log(`  ${t.stage}: ${t.detail}`);
}

function describe(d: DocumentRequirement): string {
  const note = d.note ? `\n            note: ${d.note}` : "";
  if (!d.alternatives?.length) return d.name + note;
  const how = d.mode === "ANY_OF" ? "any one of" : d.mode === "AT_LEAST_N" ? `any ${d.minimumRequired} of` : "all of";
  return `${d.name} (${how}: ${d.alternatives.map((a) => a.name).join(", ")})${note}`;
}
