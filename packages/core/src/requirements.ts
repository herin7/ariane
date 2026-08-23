import { evaluateCondition } from "./condition";
import { appliesTo } from "./jurisdiction";
import type { Facts, RequirementGroup, RequirementGroupMember, Truth } from "./types";

/**
 * Requirement group evaluation: the AND / OR / N-of logic that government
 * document lists are actually written in.
 *
 * The failure mode this exists to prevent is telling a citizen to go and get
 * six documents when the rule was "any one of these six". That is not a
 * cosmetic bug, it is hours of someone's day at a government office.
 */

export interface GroupContext {
  /** Node ids the citizen already holds or has completed. */
  held: Set<string>;
  facts: Facts;
  /** Citizen jurisdiction chain, most specific first. */
  chain: string[];
  /** Resolve a nested group owned by a member node, for group-in-group rules. */
  groupsFor?: (nodeId: string) => RequirementGroup[];
}

export interface GroupEvaluation {
  groupId: string;
  ownerNodeId: string;
  mode: RequirementGroup["mode"];
  /** How many members must be held. 1 for ANY_OF, all of them for ALL_OF. */
  minimumRequired: number;
  satisfied: Truth;
  /** Members the citizen already has. */
  satisfiedMembers: string[];
  /** Members that apply to this citizen but are not held yet. */
  missingMembers: string[];
  /** Members whose own condition excludes them for this citizen. */
  inapplicableMembers: string[];
  /** Members we cannot rule in or out until a question is answered. */
  undecidedMembers: string[];
}

/** Which members are live for this citizen, and which were conditioned out. */
function partitionMembers(
  members: RequirementGroupMember[],
  ctx: GroupContext,
): { applicable: RequirementGroupMember[]; inapplicable: string[]; undecided: string[] } {
  const applicable: RequirementGroupMember[] = [];
  const inapplicable: string[] = [];
  const undecided: string[] = [];

  for (const member of members) {
    const truth = evaluateCondition(member.condition, ctx.facts);
    if (truth === "FALSE") inapplicable.push(member.nodeId);
    else {
      applicable.push(member);
      if (truth === "UNKNOWN") undecided.push(member.nodeId);
    }
  }
  return { applicable, inapplicable, undecided };
}

/**
 * Is a single member held? A member can itself own a group (an address proof
 * inside an identity bundle), so this recurses. Depth guarded because the
 * data is scraped and a self referential group must not hang the request.
 */
function memberHeld(nodeId: string, ctx: GroupContext, seen: Set<string>): Truth {
  if (ctx.held.has(nodeId)) return "TRUE";
  if (seen.has(nodeId)) return "FALSE"; // cycle in source data, treat as not held
  seen.add(nodeId);

  const nested = ctx.groupsFor?.(nodeId) ?? [];
  if (!nested.length) return "FALSE";

  // A node with several groups needs all of them, they are separate rules.
  let sawUnknown = false;
  for (const group of nested) {
    const result = evaluateGroup(group, ctx, seen);
    if (result.satisfied === "FALSE") return "FALSE";
    if (result.satisfied === "UNKNOWN") sawUnknown = true;
  }
  return sawUnknown ? "UNKNOWN" : "TRUE";
}

export function evaluateRequirementGroup(group: RequirementGroup, ctx: GroupContext): GroupEvaluation {
  return evaluateGroup(group, ctx, new Set());
}

function evaluateGroup(group: RequirementGroup, ctx: GroupContext, seen: Set<string>): GroupEvaluation {
  const base = {
    groupId: group.id,
    ownerNodeId: group.ownerNodeId,
    mode: group.mode,
  };

  // A group scoped to another state, or gated off by the citizen's answers,
  // imposes nothing. Vacuously satisfied, not failed.
  if (!appliesTo(group.jurisdictionId, ctx.chain) || evaluateCondition(group.condition, ctx.facts) === "FALSE") {
    return {
      ...base,
      minimumRequired: 0,
      satisfied: "TRUE",
      satisfiedMembers: [],
      missingMembers: [],
      inapplicableMembers: group.members.map((m) => m.nodeId),
      undecidedMembers: [],
    };
  }

  const { applicable, inapplicable, undecided } = partitionMembers(group.members, ctx);

  const satisfiedMembers: string[] = [];
  const missingMembers: string[] = [];
  let unknownCount = 0;

  for (const member of applicable) {
    const truth = memberHeld(member.nodeId, ctx, new Set(seen));
    if (truth === "TRUE") satisfiedMembers.push(member.nodeId);
    else {
      missingMembers.push(member.nodeId);
      if (truth === "UNKNOWN") unknownCount++;
    }
  }

  const minimumRequired = requiredCount(group, applicable.length);
  const have = satisfiedMembers.length;

  let satisfied: Truth;
  if (have >= minimumRequired) satisfied = "TRUE";
  else if (have + unknownCount + undecided.length >= minimumRequired) satisfied = "UNKNOWN";
  else satisfied = "FALSE";

  return {
    ...base,
    minimumRequired,
    satisfied,
    satisfiedMembers,
    missingMembers,
    inapplicableMembers: inapplicable,
    undecidedMembers: undecided,
  };
}

/** How many of the applicable members actually have to be held. */
function requiredCount(group: RequirementGroup, applicableCount: number): number {
  switch (group.mode) {
    case "ANY_OF":
      // An ANY_OF with nothing applicable left demands nothing, rather than
      // becoming permanently unsatisfiable.
      return applicableCount === 0 ? 0 : 1;
    case "AT_LEAST_N":
      return Math.min(Math.max(group.minimumRequired ?? 1, 0), applicableCount);
    default:
      return applicableCount;
  }
}
