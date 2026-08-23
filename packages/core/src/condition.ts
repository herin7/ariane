import type { Condition, ConditionOperator, Facts, Predicate, Truth } from "./types";

/**
 * Deterministic condition evaluator.
 *
 * Three-valued (Kleene) on purpose. A condition we cannot decide yet is not a
 * failure, it is a question. UNKNOWN propagates outward and the journey
 * compiler turns whatever is still UNKNOWN into the question flow, which is
 * how "ask only what changes the graph" is implemented.
 *
 * EXISTS / NOT_EXISTS are the exception: they are always decidable, because
 * the fact bag is built closed-world for possession style fields. If
 * "document:aadhaar" is absent from the bag, the citizen does not hold it. We
 * never need to ask a condition about that, the document checklist covers it.
 *
 * Nothing here executes source data. Conditions are inert JSON, never code.
 */

function isPredicate(c: Condition): c is Predicate {
  return typeof (c as Predicate).field === "string";
}

const NOT: Record<Truth, Truth> = { TRUE: "FALSE", FALSE: "TRUE", UNKNOWN: "UNKNOWN" };

export function evaluateCondition(condition: Condition | undefined, facts: Facts): Truth {
  if (!condition) return "TRUE";

  if ("all" in condition) {
    let sawUnknown = false;
    for (const child of condition.all) {
      const r = evaluateCondition(child, facts);
      if (r === "FALSE") return "FALSE"; // one false sinks the conjunction
      if (r === "UNKNOWN") sawUnknown = true;
    }
    return sawUnknown ? "UNKNOWN" : "TRUE";
  }

  if ("any" in condition) {
    let sawUnknown = false;
    for (const child of condition.any) {
      const r = evaluateCondition(child, facts);
      if (r === "TRUE") return "TRUE"; // one true carries the disjunction
      if (r === "UNKNOWN") sawUnknown = true;
    }
    return sawUnknown ? "UNKNOWN" : "FALSE";
  }

  if ("not" in condition) return NOT[evaluateCondition(condition.not, facts)];

  if (isPredicate(condition)) return evaluatePredicate(condition, facts);

  // Malformed source data. Refuse to guess.
  return "UNKNOWN";
}

function evaluatePredicate(p: Predicate, facts: Facts): Truth {
  const present = Object.prototype.hasOwnProperty.call(facts, p.field) && facts[p.field] !== undefined;

  if (p.operator === "EXISTS") return present ? "TRUE" : "FALSE";
  if (p.operator === "NOT_EXISTS") return present ? "FALSE" : "TRUE";

  if (!present) return "UNKNOWN"; // we simply have not asked yet

  const actual = facts[p.field];
  return compare(p.operator, actual, p.value);
}

function compare(operator: ConditionOperator, actual: unknown, expected: unknown): Truth {
  switch (operator) {
    case "EQ":
      return sameValue(actual, expected) ? "TRUE" : "FALSE";
    case "NEQ":
      return sameValue(actual, expected) ? "FALSE" : "TRUE";

    case "IN":
    case "NOT_IN": {
      if (!Array.isArray(expected)) return "UNKNOWN"; // bad data, do not guess
      const hit = Array.isArray(actual)
        ? actual.some((a) => expected.some((e) => sameValue(a, e)))
        : expected.some((e) => sameValue(actual, e));
      const truth: Truth = hit ? "TRUE" : "FALSE";
      return operator === "IN" ? truth : NOT[truth];
    }

    case "GT":
    case "GTE":
    case "LT":
    case "LTE": {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a === undefined || b === undefined) return "UNKNOWN";
      switch (operator) {
        case "GT":
          return a > b ? "TRUE" : "FALSE";
        case "GTE":
          return a >= b ? "TRUE" : "FALSE";
        case "LT":
          return a < b ? "TRUE" : "FALSE";
        default:
          return a <= b ? "TRUE" : "FALSE";
      }
    }

    default:
      return "UNKNOWN";
  }
}

/** Loose across the number/string boundary, because form input is stringly typed. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Every field name a condition mentions, in first-seen order. */
export function collectFields(condition: Condition | undefined, into: string[] = []): string[] {
  if (!condition) return into;
  if ("all" in condition) condition.all.forEach((c) => collectFields(c, into));
  else if ("any" in condition) condition.any.forEach((c) => collectFields(c, into));
  else if ("not" in condition) collectFields(condition.not, into);
  else if (isPredicate(condition) && !into.includes(condition.field)) into.push(condition.field);
  return into;
}

/**
 * The fields that are actually holding up a decision: referenced, not yet
 * answered, and not the always-decidable possession operators. This is the
 * question list, minus the ones the graph does not need.
 */
export function unresolvedFields(condition: Condition | undefined, facts: Facts, into: string[] = []): string[] {
  if (!condition) return into;
  if (evaluateCondition(condition, facts) !== "UNKNOWN") return into;

  if ("all" in condition) condition.all.forEach((c) => unresolvedFields(c, facts, into));
  else if ("any" in condition) condition.any.forEach((c) => unresolvedFields(c, facts, into));
  else if ("not" in condition) unresolvedFields(condition.not, facts, into);
  else if (isPredicate(condition)) {
    if (condition.operator !== "EXISTS" && condition.operator !== "NOT_EXISTS" && !into.includes(condition.field)) {
      into.push(condition.field);
    }
  }
  return into;
}
