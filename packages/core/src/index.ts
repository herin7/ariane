export * from "./types";
export { collectFields, evaluateCondition, unresolvedFields } from "./condition";
export { JurisdictionIndex, appliesTo, specificity, type ResolvedJurisdiction } from "./jurisdiction";
export {
  GraphIndex,
  extractSubgraph,
  filterEdges,
  nodeApplies,
  topologicalSort,
  traverse,
  type EdgeFilter,
  type FilteredEdge,
  type TopoResult,
  type TraversalResult,
} from "./graph";
export { evaluateRequirementGroup, type GroupContext, type GroupEvaluation } from "./requirements";
export {
  CITIZEN_STAGES,
  GoalNotFoundError,
  JourneyCompiler,
  JurisdictionNotFoundError,
  compileJourney,
  stageGroups,
} from "./journey";
export { resolveIntent, type IntentMatch } from "./intent";
export {
  compilePlan,
  type CompiledPlan,
  type PlanItem,
  type PlanRequest,
  type PlanTrack,
} from "./plan";
export {
  CONFLICT_TOLERANCE_KM,
  addressHash,
  formatCrowKm,
  formatDuration,
  formatRoutedKm,
  geocodeQueries,
  geocodeQuery,
  gradeCandidate,
  haversineKm,
  pincodeOf,
  rankByDistance,
  rankByJurisdiction,
  reconcileConflict,
  type GateInput,
  type GateResult,
  type GeocodeCandidate,
  type Point,
  type RankedOffice,
} from "./location";
// Shapes and pure folds only. Rows come from `@ariane/core/server`, which is
// where the disk and the database are, and which a browser bundle cannot see.
export {
  journeysOf,
  loadGraphFrom,
  validateGraph,
  type GraphBundle,
  type GraphIssue,
} from "./data/index";
