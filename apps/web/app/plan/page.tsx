import { Suspense } from "react";
import { graph } from "../graph";
import { PlanView } from "./view";

export const revalidate = 60;

/** Same districts, same source as `/journey`: the jurisdiction rows. */
export default async function PlanPage() {
  const data = await graph();
  const districts = data.jurisdictions
    .filter((j) => j.level === "DISTRICT" && j.parentId === "IN-GJ")
    .map((j) => j.name)
    .sort((a, b) => a.localeCompare(b));

  return (
    <Suspense fallback={<p className="muted">Loading</p>}>
      <PlanView districts={districts} />
    </Suspense>
  );
}
