import type { Jurisdiction, JurisdictionLevel, JurisdictionQuery } from "./types.js";

/**
 * Jurisdiction resolution.
 *
 * The point of this file is that no other file in the engine ever needs to
 * know a state exists. Gujarat is a row, not a branch. Adding Maharashtra is
 * adding data.
 */

export interface ResolvedJurisdiction {
  /** Most specific jurisdiction we could match from the citizen's answers. */
  id: string;
  name: string;
  /** Most specific first, root last: ["IN-GJ-AHMEDABAD", "IN-GJ", "IN"]. */
  chain: string[];
}

const LEVEL_ORDER: JurisdictionLevel[] = ["COUNTRY", "STATE", "DISTRICT", "TALUKA", "LOCAL_BODY"];

export class JurisdictionIndex {
  private readonly byId = new Map<string, Jurisdiction>();
  private readonly childrenOf = new Map<string, Jurisdiction[]>();

  constructor(jurisdictions: Jurisdiction[]) {
    for (const j of jurisdictions) {
      this.byId.set(j.id, j);
      const key = j.parentId ?? "";
      const bucket = this.childrenOf.get(key);
      if (bucket) bucket.push(j);
      else this.childrenOf.set(key, [j]);
    }
  }

  get(id: string): Jurisdiction | undefined {
    return this.byId.get(id);
  }

  children(parentId: string | undefined): Jurisdiction[] {
    return this.childrenOf.get(parentId ?? "") ?? [];
  }

  /** Most specific first, up to the root. */
  chainFor(id: string): string[] {
    const chain: string[] = [];
    let cursor = this.byId.get(id);
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.push(cursor.id);
      cursor = cursor.parentId ? this.byId.get(cursor.parentId) : undefined;
    }
    return chain;
  }

  /**
   * Walk down from the country as far as the citizen's answers let us. An
   * unrecognised district is not an error, we just stop at the state and
   * compile a state level journey.
   */
  resolve(query: JurisdictionQuery): ResolvedJurisdiction | undefined {
    const wanted: (string | undefined)[] = [query.country, query.state, query.district, query.taluka];

    let current = this.matchAmong(this.children(undefined), wanted[0], "COUNTRY");
    if (!current) return undefined;

    for (let depth = 1; depth < wanted.length; depth++) {
      const label = wanted[depth];
      if (!label) break;
      const next = this.matchAmong(this.children(current.id), label, LEVEL_ORDER[depth]);
      if (!next) break; // unknown district, stay at the level we do know
      current = next;
    }

    return { id: current.id, name: current.name, chain: this.chainFor(current.id) };
  }

  private matchAmong(
    candidates: Jurisdiction[],
    label: string | undefined,
    level: JurisdictionLevel | undefined,
  ): Jurisdiction | undefined {
    if (!label) return undefined;
    const needle = normalise(label);
    return candidates.find(
      (c) =>
        (level === undefined || c.level === level) &&
        (normalise(c.id) === needle ||
          normalise(c.name) === needle ||
          normalise(lastSegment(c.id)) === needle),
    );
  }
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function lastSegment(id: string): string {
  const parts = id.split("-");
  return parts[parts.length - 1] ?? id;
}

/**
 * A scoped fact applies if its scope is the citizen's jurisdiction or an
 * ancestor of it. Undefined scope means universal, which is how national
 * services participate in a Gujarat journey without being duplicated.
 */
export function appliesTo(scopeId: string | undefined, chain: string[]): boolean {
  if (!scopeId) return true;
  return chain.includes(scopeId);
}

/**
 * How closely a scope targets this citizen. Higher wins. Used to let a
 * district rule override a state rule which overrides a national default,
 * without any of those being special cased in code.
 */
export function specificity(scopeId: string | undefined, chain: string[]): number {
  if (!scopeId) return 0;
  const index = chain.indexOf(scopeId);
  if (index === -1) return -1; // does not apply at all
  return chain.length - index; // most specific entry sits at index 0
}
