import type { GraphEdge, GraphNode } from "../types";
import escalation from "./graph/escalation.json";

/**
 * Escalation, shared by every journey.
 *
 * CPGRAMS and SWAGAT are not tied to one department. CPGRAMS says so in as
 * many words ("connected to all the Ministries/Departments of Government of
 * India and States") and SWAGAT is the Gujarat wide programme. So rather than
 * hanging them off individual services by hand, the two edges in the
 * escalation bundle's `edgeTemplates` are written with `*` where the service
 * id goes, and stamped out here for every SERVICE node in the graph. They are
 * kept apart from `edges` because a template is not an edge: `*` is not a node
 * and the validator is right to say so.
 *
 * The claim and its quote are rows like everything else. Only the stamping is
 * code, because writing it out per service would be forty copies of the same
 * two sentences waiting to drift apart.
 */

const templates = escalation.edgeTemplates as unknown as GraphEdge[];

export function attachEscalation(serviceNodes: GraphNode[]): GraphEdge[] {
  return serviceNodes.flatMap((service) =>
    templates.map((t) => ({ ...t, id: t.id.replace("*", service.id), from: service.id })),
  );
}
