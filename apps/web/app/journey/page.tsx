import { Suspense } from "react";
import { JourneyView } from "./view";

export default function JourneyPage() {
  return (
    <Suspense fallback={<p className="muted">Loading</p>}>
      <JourneyView />
    </Suspense>
  );
}
