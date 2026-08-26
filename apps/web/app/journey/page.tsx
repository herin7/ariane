import { graph } from "../graph";
import { Suspense } from "react";
import { JourneyView } from "./view";

export const revalidate = 60;

/**
 * Districts come off the jurisdiction rows, not out of an array in the client.
 * There were 33 of them typed into view.tsx, which meant a new district was a
 * code change in two places and a chance for the two lists to disagree.
 */
export default async function JourneyPage() {
  const data = await graph();
  const districts = data.jurisdictions
    .filter((j) => j.level === "DISTRICT" && j.parentId === "IN-GJ")
    .map((j) => j.name)
    .sort((a, b) => a.localeCompare(b));

  return (
    <Suspense fallback={<p className="muted">Loading</p>}>
      <JourneyView districts={districts} />
    </Suspense>
  );
}
