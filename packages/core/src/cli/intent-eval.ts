import { loadGraph } from "../data/index";
import { resolveIntent } from "../intent";
import { pickService, bedrockConfigFromEnv, type ServiceChoice } from "../lang/bedrock";

/**
 * How often we send a citizen to the right service when they describe a problem.
 *
 * "LLM UNDERSTANDS. GRAPH DECIDES." is the whole thesis and until this existed
 * there was no number attached to the first half. Every other gate in this repo
 * checks that we did not make something up. This one checks that we found
 * anything at all, which is the failure nobody notices because it looks like an
 * empty page rather than a wrong answer.
 *
 * Not a vitest file on purpose. It costs one model call per case against a real
 * endpoint, and a suite that spends credits on `pnpm test` is a suite people
 * stop running. Run it when the graph or the prompt changes.
 *
 *   pnpm intent:eval
 *
 * With no `AWS_BEARER_TOKEN_BEDROCK` it reports the overlap column and stops,
 * which is still worth knowing.
 *
 * Read the score as a range, not a number. Consecutive runs at temperature 0
 * scored 14/15 and 12/15 against an unchanged graph, because the endpoint is
 * not bit reproducible. Overlap alone scores 3/15 and does so every time, which
 * is the comparison that matters and the reason the model pass exists at all.
 */

/**
 * What a citizen says, and every service id that would be a fair answer.
 *
 * `null` means the honest answer is NONE, and those cases matter more than they
 * look. A model that never says NONE scores well here and sends the person
 * asking about flights to the Mamlatdar.
 *
 * Several entries list more than one id because more than one is defensible.
 * "my scooter is still in the seller's name" is transfer of ownership, which
 * lives under two services in this graph, and marking either wrong would be
 * grading the graph's shape rather than the model's reading.
 */
const CASES: { said: string; want: string[] | null; note?: string }[] = [
  { said: "I am 70 and nobody supports me", want: ["service:old_age_pension"] },
  { said: "my husband died last year and I have two small children and no income", want: ["service:widow_pension"] },
  { said: "my father died and I need to prove I am the heir", want: ["service:varshai"] },
  { said: "need a document proving how much I earn", want: ["service:income_certificate"] },
  { said: "I have lived in Gujarat all my life and the college wants proof", want: ["service:domicile_certificate", "service:nationality_certificate"] },
  { said: "my scooter was sold to me but the papers are still in the old owner's name", want: ["service:vehicle_registration", "service:registration_certificate_services"] },
  { said: "I want to learn to drive and get my first licence", want: ["service:learner_licence"] },
  { said: "I need my degree certificate accepted by a university abroad", want: ["service:apostille"] },
  { said: "I left my job and want my provident fund money", want: ["service:pf_final_settlement"] },
  { said: "I am a student and need money to pay college fees", want: ["service:nsp_scholarship", "service:mysy"] },
  { said: "my family is below poverty line and we need subsidised grain", want: ["service:antyodaya_anna_yojana_aay_ration_card"] },
  { said: "I run a small workshop with four workers and want it registered as an MSME", want: ["service:udyam_registration"] },
  { said: "I want to see the official record for a piece of land", want: ["service:property_records"] },
  { said: "I want to buy a flight to Dubai next month", want: null, note: "not a government service" },
  { said: "what is the weather in Rajkot tomorrow", want: null, note: "not a government service" },
];

const data = loadGraph();
const catalogue: ServiceChoice[] = data.nodes
  .filter((n) => n.type === "SERVICE")
  .map((n) => ({ id: n.id, name: n.name, officialName: n.officialName, aliases: n.aliases }));

// An expected id that is not in the graph is a broken case, not a failing model.
// Say so loudly rather than quietly counting a correct NONE as a miss.
const known = new Set(catalogue.map((c) => c.id));
const stale = CASES.flatMap((c) => c.want ?? []).filter((id) => !known.has(id));
if (stale.length) {
  console.log(`\n${stale.length} expected id(s) no longer exist in the graph: ${stale.join(", ")}`);
  console.log("Fix the case list, not the model. A case pointing at nothing grades nothing.\n");
}

const configured = Boolean(bedrockConfigFromEnv());
if (!configured) {
  console.log("\nNo AWS_BEARER_TOKEN_BEDROCK. Reporting token overlap only, which is the floor, not the product.\n");
}

let overlapHits = 0;
let modelHits = 0;
const rows: string[] = [];

for (const { said, want } of CASES) {
  const overlap = resolveIntent(data, said)[0];
  const overlapRight = want === null ? !overlap : Boolean(overlap && want.includes(overlap.goal));
  if (overlapRight) overlapHits++;

  const picked = configured ? await pickService(said, catalogue) : undefined;
  const modelRight = want === null ? picked === undefined : Boolean(picked && want.includes(picked));
  if (modelRight) modelHits++;

  const mark = (ok: boolean) => (ok ? "  ok" : "MISS");
  rows.push(
    `${mark(overlapRight)} ${mark(modelRight)}  ${said}\n` +
      `            overlap: ${overlap ? `${overlap.goal} (${overlap.confidence.toFixed(2)})` : "nothing"}\n` +
      `            model:   ${picked ?? "NONE"}${configured ? "" : " (not run)"}\n` +
      `            wanted:  ${want ? want.join(" | ") : "NONE"}`,
  );
}

console.log(rows.join("\n\n"));
console.log(`\noverlap alone: ${overlapHits}/${CASES.length}`);
if (configured) console.log(`with the model: ${modelHits}/${CASES.length}`);

// Exit code is for a person reading it, not a gate. The model is a fallback and
// a bad day for it is a citizen asked to rephrase, not a citizen misdirected.
