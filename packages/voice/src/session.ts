import type { JurisdictionQuery } from "@ariane/core";
import {
  callerHash as hashCaller,
  hashToken,
  initialIdentityLevel,
  newSessionId,
  newToken,
  tokenMatches,
} from "./identity";
import { LIMITS, readOnlyToolsFor, toolsFor } from "./policy";
import type { VoiceStore } from "./store";
import type {
  IdentityLevel,
  IssuedSession,
  RefusalCode,
  VoiceProvider,
  VoiceSession,
} from "./types";

/**
 * Sessions: the thing every access decision in this package actually consults.
 *
 * A session is created server side, from a transport the server authenticated,
 * and from that moment it is the single source of truth for who is on the line
 * and what they may reach. Nothing the model says and nothing the browser posts
 * can alter it. That is the entire design: §9 is not a rule the model is asked
 * to follow, it is a field the model has no way to write.
 */

export interface SessionsConfig {
  store: VoiceStore;
  /** VOICE_SESSION_SECRET. Keys the token hash. */
  secret: string;
  /** VOICE_PHONE_HMAC_SECRET. Keys the caller hash. */
  phoneSecret: string;
  /** Injectable for tests, so a budget test does not have to sleep. */
  now?: () => number;
}

export interface CreateSessionInput {
  provider: VoiceProvider;
  providerCallId?: string;
  /** Raw caller id from the telephony provider. Hashed here and then dropped. */
  rawPhone?: string;
  jurisdiction?: JurisdictionQuery;
  language?: string;
}

export type CreateSessionResult =
  | { ok: true; session: VoiceSession; issued: IssuedSession; returning: boolean }
  | { ok: false; code: RefusalCode; speak: string };

export class VoiceSessions {
  private readonly now: () => number;

  constructor(private readonly config: SessionsConfig) {
    this.now = config.now ?? Date.now;
    if (!config.secret) throw new Error("VOICE_SESSION_SECRET is required");
    if (!config.phoneSecret) throw new Error("VOICE_PHONE_HMAC_SECRET is required");
  }

  /**
   * Open a call.
   *
   * The identity level is decided here, once, from things the server can check:
   * whether the transport gave us a caller id, and whether that caller id
   * matches a citizen who has consented to being remembered. It is never
   * decided later, and never by anything said out loud.
   */
  async create(input: CreateSessionInput): Promise<CreateSessionResult> {
    const { store } = this.config;
    const at = this.now();

    const caller = hashCaller(input.rawPhone, this.config.phoneSecret);

    // §17, before anything expensive exists. Concurrency first: it is the
    // cheapest check and the one an abuser trips first.
    if (caller) {
      if ((await store.activeSessionsFor(caller)) >= LIMITS.maxConcurrentSessionsPerCaller) {
        return { ok: false, code: "RATE_LIMITED", speak: "You already have a call open with me. Let me finish that one first." };
      }
      if ((await store.msToday(caller)) >= LIMITS.dailyCallerMs) {
        return { ok: false, code: "RATE_LIMITED", speak: "We have talked a lot today. Please try again tomorrow." };
      }
    }
    if ((await store.msToday()) >= LIMITS.dailyGlobalMs) {
      return { ok: false, code: "RATE_LIMITED", speak: "I am handling more calls than I can right now. Please try again shortly." };
    }

    /**
     * A returning caller is looked up but not automatically trusted.
     *
     * `citizenByCaller` reads; it never creates. A citizen row exists only for
     * somebody who said yes to being remembered, so finding one means consent
     * is already on file and RECOGNIZED is honest. Finding nothing means a
     * first call or a caller who said no, and both are ANONYMOUS.
     */
    const citizen = caller ? await store.citizenByCaller(caller) : undefined;
    const remembered = citizen?.consentState === "GRANTED" ? citizen : undefined;
    const identityLevel = initialIdentityLevel({
      callerHash: caller,
      citizenId: remembered?.id,
    });

    const token = newToken();
    const session: VoiceSession = {
      id: newSessionId(),
      provider: input.provider,
      providerCallId: input.providerCallId,
      citizenId: remembered?.id,
      callerHash: caller,
      identityLevel,
      allowedTools: toolsFor(identityLevel),
      jurisdiction: input.jurisdiction ?? {
        country: "IN",
        state: "GJ",
        ...(remembered?.district ? { district: remembered.district } : {}),
      },
      // A language preference is presentation, so a recognised caller may have
      // one applied without proving anything. It reveals nothing about them
      // that the first word out of their mouth would not.
      language: input.language ?? remembered?.preferredLanguage,
      tokenHash: hashToken(token, this.config.secret),
      startedAt: at,
      expiresAt: at + LIMITS.maxCallMs,
      status: "ACTIVE",
      budget: { toolCalls: 0, invalidToolCalls: 0, consecutiveFailures: 0, turns: 0 },
    };

    await store.putSession(session);
    return {
      ok: true,
      session,
      returning: Boolean(remembered),
      issued: {
        sessionId: session.id,
        token,
        expiresAt: session.expiresAt,
        identityLevel: session.identityLevel,
        allowedTools: session.allowedTools,
      },
    };
  }

  /**
   * The browser relay's door. Session id plus bearer token, both required.
   *
   * Returns a refusal code rather than throwing, because every one of these is
   * an ordinary thing that happens on a flaky mobile connection and the caller
   * needs to hear a sentence, not a stack trace.
   */
  async authenticate(sessionId: string, token: string): Promise<VoiceSession | RefusalCode> {
    const session = await this.config.store.session(sessionId);
    if (!session) return "NO_SESSION";
    if (!tokenMatches(hashToken(token, this.config.secret), session.tokenHash)) return "NO_SESSION";
    return this.check(session);
  }

  /**
   * Telephony's door. The webhook signature is checked before this runs, so
   * what is being established here is that the *call* is the one the session
   * was opened for. A valid signature on a payload naming another call id gets
   * nothing.
   */
  async authenticateCall(sessionId: string, providerCallId: string): Promise<VoiceSession | RefusalCode> {
    const session = await this.config.store.session(sessionId);
    if (!session) return "NO_SESSION";
    if (!session.providerCallId || session.providerCallId !== providerCallId) return "NO_SESSION";
    return this.check(session);
  }

  /** Find the session a provider call belongs to, without trusting a session id. */
  async byProviderCall(providerCallId: string): Promise<VoiceSession | undefined> {
    return this.config.store.sessionByProviderCall?.(providerCallId);
  }

  private check(session: VoiceSession): VoiceSession | RefusalCode {
    const at = this.now();
    if (session.status !== "ACTIVE") return "SESSION_ENDED";
    if (session.expiresAt <= at) return "SESSION_EXPIRED";
    if (at - session.startedAt > LIMITS.maxSessionLifetimeMs) return "SESSION_EXPIRED";
    return session;
  }

  /** Persist a session the broker mutated. One place, so nothing forgets. */
  async save(session: VoiceSession): Promise<void> {
    await this.config.store.putSession(session);
  }

  async end(session: VoiceSession): Promise<void> {
    session.status = "ENDED";
    session.expiresAt = Math.min(session.expiresAt, this.now());
    // A journey belonging to a consenting citizen survives the call. Everything
    // else goes with it, which is the difference between memory and a recording.
    if (session.citizenId && session.activeJourney) {
      await this.config.store.saveJourney(session.citizenId, session.activeJourney, "IN_PROGRESS");
    }
    await this.save(session);
  }

  /**
   * §16. Something went wrong in a way that might not be an accident, so the
   * call keeps working and stops being able to write anything.
   *
   * Deliberately not "end the call". A citizen who phrased a question in a way
   * a guardrail disliked should still be able to hear the fee for a birth
   * certificate; they should not be able to save anything while doing it.
   */
  async downgrade(session: VoiceSession, reason: string): Promise<VoiceSession> {
    session.identityLevel = "ANONYMOUS";
    session.allowedTools = readOnlyToolsFor("ANONYMOUS");
    session.citizenId = undefined;
    session.downgradeReason = reason;
    await this.save(session);
    return session;
  }

  /**
   * The one way up, and it takes a citizen id the *server* produced from a
   * completed step-up challenge. There is no tool that reaches this.
   */
  async upgrade(session: VoiceSession, citizenId: string, level: IdentityLevel = "VERIFIED"): Promise<VoiceSession> {
    session.citizenId = citizenId;
    session.identityLevel = level;
    session.allowedTools = toolsFor(level);
    await this.save(session);
    return session;
  }
}
