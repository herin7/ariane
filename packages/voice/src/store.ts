import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveJourney, VoiceSession } from "./types";

/**
 * The only way this package reaches a database.
 *
 * §28: narrow helpers, never a query builder. Every method below takes ids the
 * *server* resolved and nothing else. There is no `find(where)`, no `select`,
 * no table name parameter and no place to pass a filter, so there is nothing
 * for a tool argument to widen even if one ever reached this far. The broker
 * could hand every method a string a caller dictated and the worst outcome
 * would be a row that does not exist.
 *
 * Two implementations. Postgres is the product; the in-memory one is what the
 * tests, a laptop with no credentials and `pnpm dev` all run on, in the same
 * shape as `loadLiveGraph()` falling back to the seed. Nothing about voice
 * should require a database to try.
 */

export type ConsentState = "UNKNOWN" | "GRANTED" | "DENIED";

export interface Citizen {
  id: string;
  callerHash: string;
  preferredLanguage?: string;
  district?: string;
  consentState: ConsentState;
  createdAt: number;
  lastSeenAt: number;
}

export interface StoredJourney extends ActiveJourney {
  citizenId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  startedAt: number;
}

export interface StoredDocument {
  documentId: string;
  status: "HELD" | "MISSING" | "EXPIRED";
  source: "CITIZEN_SAID" | "VERIFIED";
  updatedAt: number;
}

/** Keys `save_preference` accepts. Mirrors the enum in `schemas.ts`. */
export type PreferenceKey = "preferred_language" | "response_style" | "district";

export interface VoiceStore {
  // -- citizens ------------------------------------------------------------
  /**
   * A caller we have met before, by hash. Returns undefined rather than
   * creating, so recognising somebody and deciding to remember them stay two
   * separate decisions with consent in between.
   */
  citizenByCaller(callerHash: string): Promise<Citizen | undefined>;
  /** Called only once consent to be remembered exists. */
  createCitizen(callerHash: string): Promise<Citizen>;
  setConsent(citizenId: string, state: ConsentState): Promise<void>;

  // -- preferences ---------------------------------------------------------
  preferences(citizenId: string): Promise<Partial<Record<PreferenceKey, string>>>;
  savePreference(citizenId: string, key: PreferenceKey, value: string): Promise<void>;

  // -- journeys ------------------------------------------------------------
  /** The one to offer on a return call. Most recently touched, in progress. */
  latestJourney(citizenId: string): Promise<StoredJourney | undefined>;
  saveJourney(citizenId: string, journey: ActiveJourney, status: StoredJourney["status"]): Promise<void>;

  // -- documents -----------------------------------------------------------
  documents(citizenId: string): Promise<StoredDocument[]>;
  confirmDocument(citizenId: string, documentId: string, status: StoredDocument["status"]): Promise<void>;

  // -- erasure -------------------------------------------------------------
  /**
   * §13. Actually removes; does not tombstone and does not "mark inactive".
   * Returns what went, so the caller can be told a number instead of a promise.
   */
  forget(citizenId: string): Promise<{ removed: number }>;

  // -- sessions ------------------------------------------------------------
  putSession(session: VoiceSession): Promise<void>;
  session(sessionId: string): Promise<VoiceSession | undefined>;
  /**
   * The session a telephony call belongs to. The webhook knows the provider's
   * call id and nothing else, so this is how a signed payload finds its session
   * without the payload being allowed to name one.
   */
  sessionByProviderCall(providerCallId: string): Promise<VoiceSession | undefined>;
  /** §17: one person, one conversation. Counts ACTIVE, unexpired sessions. */
  activeSessionsFor(callerHash: string): Promise<number>;
  /** Milliseconds of call time today, for the per-caller and global ceilings. */
  msToday(callerHash?: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------

/**
 * The default. Correct, isolated, and gone when the process ends, which for a
 * caller with no consent on file is exactly the retention policy §12 asks for.
 *
 * ponytail: one process only. Two web instances would each hold their own
 * sessions, so put Postgres behind it before running more than one.
 */
export function memoryStore(): VoiceStore {
  const citizens = new Map<string, Citizen>();
  const byCaller = new Map<string, string>();
  const prefs = new Map<string, Map<PreferenceKey, string>>();
  const journeys = new Map<string, StoredJourney[]>();
  const docs = new Map<string, Map<string, StoredDocument>>();
  const sessions = new Map<string, VoiceSession>();
  let seq = 0;

  const dayOf = (at: number) => Math.floor(at / 86_400_000);
  const elapsed = (s: VoiceSession, now: number) => Math.min(now, s.expiresAt) - s.startedAt;

  return {
    async citizenByCaller(hash) {
      const id = byCaller.get(hash);
      return id ? citizens.get(id) : undefined;
    },
    async createCitizen(hash) {
      const existing = byCaller.get(hash);
      if (existing) return citizens.get(existing)!;
      const now = Date.now();
      const citizen: Citizen = {
        id: `citizen_${++seq}`,
        callerHash: hash,
        consentState: "UNKNOWN",
        createdAt: now,
        lastSeenAt: now,
      };
      citizens.set(citizen.id, citizen);
      byCaller.set(hash, citizen.id);
      return citizen;
    },
    async setConsent(citizenId, state) {
      const citizen = citizens.get(citizenId);
      if (citizen) citizen.consentState = state;
    },

    async preferences(citizenId) {
      return Object.fromEntries(prefs.get(citizenId) ?? []);
    },
    async savePreference(citizenId, key, value) {
      const bag = prefs.get(citizenId) ?? new Map();
      bag.set(key, value);
      prefs.set(citizenId, bag);
      const citizen = citizens.get(citizenId);
      if (citizen && key === "preferred_language") citizen.preferredLanguage = value;
      if (citizen && key === "district") citizen.district = value;
    },

    async latestJourney(citizenId) {
      const mine = (journeys.get(citizenId) ?? []).filter((j) => j.status === "IN_PROGRESS");
      return [...mine].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    },
    async saveJourney(citizenId, journey, status) {
      const mine = journeys.get(citizenId) ?? [];
      const row: StoredJourney = {
        ...journey,
        citizenId,
        status,
        startedAt: mine.find((j) => j.id === journey.id)?.startedAt ?? journey.updatedAt,
      };
      journeys.set(citizenId, [...mine.filter((j) => j.id !== journey.id), row]);
    },

    async documents(citizenId) {
      return [...(docs.get(citizenId) ?? new Map<string, StoredDocument>()).values()];
    },
    async confirmDocument(citizenId, documentId, status) {
      const bag = docs.get(citizenId) ?? new Map<string, StoredDocument>();
      bag.set(documentId, { documentId, status, source: "CITIZEN_SAID", updatedAt: Date.now() });
      docs.set(citizenId, bag);
    },

    async forget(citizenId) {
      const removed =
        (prefs.get(citizenId)?.size ?? 0) +
        (journeys.get(citizenId)?.length ?? 0) +
        (docs.get(citizenId)?.size ?? 0) +
        (citizens.has(citizenId) ? 1 : 0);
      const citizen = citizens.get(citizenId);
      if (citizen) byCaller.delete(citizen.callerHash);
      citizens.delete(citizenId);
      prefs.delete(citizenId);
      journeys.delete(citizenId);
      docs.delete(citizenId);
      // Sessions belonging to them stop being able to reach anything of theirs.
      for (const session of sessions.values()) {
        if (session.citizenId !== citizenId) continue;
        session.citizenId = undefined;
        session.callerHash = undefined;
        session.identityLevel = "ANONYMOUS";
      }
      return { removed };
    },

    async putSession(session) {
      sessions.set(session.id, session);
    },
    async session(id) {
      return sessions.get(id);
    },
    async sessionByProviderCall(callId) {
      return [...sessions.values()].find((s) => s.providerCallId === callId);
    },
    async activeSessionsFor(hash) {
      const now = Date.now();
      return [...sessions.values()].filter(
        (s) => s.callerHash === hash && s.status === "ACTIVE" && s.expiresAt > now,
      ).length;
    },
    async msToday(hash) {
      const now = Date.now();
      const today = dayOf(now);
      return [...sessions.values()]
        .filter((s) => dayOf(s.startedAt) === today && (hash === undefined || s.callerHash === hash))
        .reduce((sum, s) => sum + Math.max(0, elapsed(s, now)), 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * The same interface over Supabase, using the service role from the server.
 *
 * Every call is `.eq("citizen_id", <an id the server resolved>)`. RLS in
 * `voice-schema.sql` denies everything to anon and publishable keys, so these
 * tables are unreachable from a browser even if a key leaks; the isolation
 * proved by the tests is enforced twice, here by construction and there by the
 * database.
 */
export function supabaseStore(db: SupabaseClient): VoiceStore {
  const rowToCitizen = (r: Record<string, unknown>): Citizen => ({
    id: String(r.id),
    callerHash: String(r.phone_hash),
    preferredLanguage: (r.preferred_language as string) ?? undefined,
    district: (r.district as string) ?? undefined,
    consentState: (r.consent_state as ConsentState) ?? "UNKNOWN",
    createdAt: Date.parse(String(r.created_at)),
    lastSeenAt: Date.parse(String(r.last_seen_at)),
  });

  /**
   * Most of a session lives in one `session_state` jsonb column rather than in
   * twelve columns nothing ever filters on. Same reasoning as `nodes.metadata`
   * in the graph schema: columns exist for what a query looks at, and no query
   * looks inside a budget counter.
   */
  const rowToSession = (r: Record<string, unknown>): VoiceSession => {
    const state = (r.session_state ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      provider: r.provider as VoiceSession["provider"],
      providerCallId: (r.provider_call_id as string) ?? undefined,
      citizenId: (r.citizen_id as string) ?? undefined,
      callerHash: (r.phone_hash as string) ?? undefined,
      identityLevel: r.identity_level as VoiceSession["identityLevel"],
      allowedTools: (r.allowed_tools as string[]) ?? [],
      activeJourney: (state.activeJourney as VoiceSession["activeJourney"]) ?? undefined,
      jurisdiction: (state.jurisdiction as VoiceSession["jurisdiction"]) ?? { country: "IN" },
      language: (state.language as string) ?? undefined,
      tokenHash: String(r.token_hash),
      startedAt: Date.parse(String(r.started_at)),
      expiresAt: Date.parse(String(r.expires_at)),
      status: r.status as VoiceSession["status"],
      budget: (state.budget as VoiceSession["budget"]) ?? {
        toolCalls: 0,
        invalidToolCalls: 0,
        consecutiveFailures: 0,
        turns: 0,
      },
      downgradeReason: (state.downgradeReason as string) ?? undefined,
    };
  };

  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`voice store: ${what}: ${error.message}`);
  };

  return {
    async citizenByCaller(hash) {
      const { data, error } = await db.from("voice_citizens").select("*").eq("phone_hash", hash).maybeSingle();
      fail("reading citizen", error);
      return data ? rowToCitizen(data) : undefined;
    },
    async createCitizen(hash) {
      const { data, error } = await db
        .from("voice_citizens")
        .upsert({ phone_hash: hash, last_seen_at: new Date().toISOString() }, { onConflict: "phone_hash" })
        .select()
        .single();
      fail("creating citizen", error);
      return rowToCitizen(data as Record<string, unknown>);
    },
    async setConsent(citizenId, state) {
      const { error } = await db.from("voice_citizens").update({ consent_state: state }).eq("id", citizenId);
      fail("setting consent", error);
    },

    async preferences(citizenId) {
      const { data, error } = await db
        .from("voice_citizen_preferences")
        .select("key,value")
        .eq("citizen_id", citizenId);
      fail("reading preferences", error);
      return Object.fromEntries((data ?? []).map((r) => [r.key as PreferenceKey, String(r.value)]));
    },
    async savePreference(citizenId, key, value) {
      const { error } = await db
        .from("voice_citizen_preferences")
        .upsert({ citizen_id: citizenId, key, value, updated_at: new Date().toISOString() }, {
          onConflict: "citizen_id,key",
        });
      fail("saving preference", error);
    },

    async latestJourney(citizenId) {
      const { data, error } = await db
        .from("voice_citizen_journeys")
        .select("*")
        .eq("citizen_id", citizenId)
        .eq("status", "IN_PROGRESS")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      fail("reading journey", error);
      if (!data) return undefined;
      return {
        id: String(data.id),
        citizenId,
        serviceId: String(data.service_id),
        answers: (data.answers_json as StoredJourney["answers"]) ?? {},
        documents: (data.documents_json as string[]) ?? [],
        status: data.status as StoredJourney["status"],
        startedAt: Date.parse(String(data.started_at)),
        updatedAt: Date.parse(String(data.updated_at)),
      };
    },
    async saveJourney(citizenId, journey, status) {
      const { error } = await db.from("voice_citizen_journeys").upsert(
        {
          id: journey.id,
          citizen_id: citizenId,
          service_id: journey.serviceId,
          answers_json: journey.answers,
          documents_json: journey.documents,
          status,
          updated_at: new Date(journey.updatedAt).toISOString(),
        },
        { onConflict: "id" },
      );
      fail("saving journey", error);
    },

    async documents(citizenId) {
      const { data, error } = await db.from("voice_citizen_documents").select("*").eq("citizen_id", citizenId);
      fail("reading documents", error);
      return (data ?? []).map((r) => ({
        documentId: String(r.document_id),
        status: r.status as StoredDocument["status"],
        source: r.source as StoredDocument["source"],
        updatedAt: Date.parse(String(r.updated_at)),
      }));
    },
    async confirmDocument(citizenId, documentId, status) {
      const { error } = await db.from("voice_citizen_documents").upsert(
        {
          citizen_id: citizenId,
          document_id: documentId,
          status,
          source: "CITIZEN_SAID",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "citizen_id,document_id" },
      );
      fail("confirming document", error);
    },

    async forget(citizenId) {
      let removed = 0;
      // Children first, then the citizen. The FKs cascade, but doing it
      // explicitly means the count is real rather than inferred.
      for (const table of ["voice_citizen_documents", "voice_citizen_journeys", "voice_citizen_preferences"]) {
        const { count, error } = await db.from(table).delete({ count: "exact" }).eq("citizen_id", citizenId);
        fail(`erasing ${table}`, error);
        removed += count ?? 0;
      }
      const { count, error } = await db
        .from("voice_citizens")
        .delete({ count: "exact" })
        .eq("id", citizenId);
      fail("erasing citizen", error);
      return { removed: removed + (count ?? 0) };
    },

    async putSession(session) {
      const { error } = await db.from("voice_sessions").upsert(
        {
          id: session.id,
          provider: session.provider,
          provider_call_id: session.providerCallId ?? null,
          citizen_id: session.citizenId ?? null,
          phone_hash: session.callerHash ?? null,
          identity_level: session.identityLevel,
          allowed_tools: session.allowedTools,
          active_journey_id: session.activeJourney?.id ?? null,
          // The journey rides on the session row so a browser caller with no
          // citizen still gets continuity across a reconnect. It goes when the
          // session does.
          session_state: {
            jurisdiction: session.jurisdiction,
            language: session.language ?? null,
            activeJourney: session.activeJourney ?? null,
            budget: session.budget,
            downgradeReason: session.downgradeReason ?? null,
          },
          token_hash: session.tokenHash,
          started_at: new Date(session.startedAt).toISOString(),
          expires_at: new Date(session.expiresAt).toISOString(),
          status: session.status,
        },
        { onConflict: "id" },
      );
      fail("saving session", error);
    },
    async session(id) {
      const { data, error } = await db.from("voice_sessions").select("*").eq("id", id).maybeSingle();
      fail("reading session", error);
      return data ? rowToSession(data) : undefined;
    },
    async sessionByProviderCall(callId) {
      const { data, error } = await db
        .from("voice_sessions")
        .select("*")
        .eq("provider_call_id", callId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      fail("reading session by call", error);
      return data ? rowToSession(data) : undefined;
    },
    async activeSessionsFor(hash) {
      const { count, error } = await db
        .from("voice_sessions")
        .select("id", { count: "exact", head: true })
        .eq("phone_hash", hash)
        .eq("status", "ACTIVE")
        .gt("expires_at", new Date().toISOString());
      fail("counting sessions", error);
      return count ?? 0;
    },
    async msToday(hash) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      let query = db.from("voice_sessions").select("started_at,expires_at,status").gte("started_at", since);
      if (hash !== undefined) query = query.eq("phone_hash", hash);
      const { data, error } = await query;
      fail("reading usage", error);
      const now = Date.now();
      return (data ?? []).reduce((sum, r) => {
        const from = Date.parse(String(r.started_at));
        const to = Math.min(now, Date.parse(String(r.expires_at)));
        return sum + Math.max(0, to - from);
      }, 0);
    },
  };
}
