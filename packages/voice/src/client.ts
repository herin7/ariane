import { checkOutput } from "./guardrails";
import { WARN_AT_MS } from "./policy";
import type { SpeakableFact, ToolResult } from "./types";

/**
 * The browser leg, client side. `@ariane/voice/client`.
 *
 * No secrets, no Node, no Supabase. It asks our server for an ephemeral
 * credential, opens WebRTC straight to the realtime model so interruption feels
 * immediate, and relays every tool call the model proposes back to our server,
 * which is the only thing allowed to decide whether the call happens.
 *
 * What this file deliberately does not do: decide anything. It does not check a
 * tool name, does not filter arguments, does not know the policy table. A
 * tampered copy of this file gets exactly the same refusals, because the broker
 * is on the other side of the network.
 */

export type VoiceState = "idle" | "queued" | "connecting" | "listening" | "speaking" | "ended" | "error";

/** Where in line, while all ten lines are busy. §5. */
export interface QueuePlace {
  position: number;
  estimatedWaitMs?: number;
  max: number;
}

/**
 * A ceiling, hit. Not an error: every one of these is the system working, and
 * the panel says so in a sentence rather than showing a status code. §23.
 */
export interface VoiceLimit {
  code: "GUEST_QUOTA" | "BUSY" | "RATE_LIMITED" | "COOLDOWN" | "CLAIM_INVALID" | "TIME_UP";
  message: string;
  /** Set on GUEST_QUOTA and RATE_LIMITED: when the allowance comes back. */
  resetAt?: number;
}

/**
 * A refusal from our own server, carried as an error so it can travel out of
 * `openSession` without every caller having to check a union.
 */
class Refused extends Error {
  constructor(readonly limit: VoiceLimit) {
    super(limit.message);
    this.name = "Refused";
  }
}

/** A journey projection, as opposed to any of the other tool results. */
const isJourney = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as { service?: { name?: unknown } }).service?.name === "string";

/** A plan projection. Tagged rather than sniffed, because a plan has no `service`. */
const isPlan = (data: unknown): boolean =>
  typeof data === "object" && data !== null && (data as { kind?: unknown }).kind === "PLAN";

export interface VoiceHandlers {
  onState?: (state: VoiceState) => void;
  /** Assistant's own words, as it says them. Only shown; never stored by us. */
  onTranscript?: (text: string, final: boolean) => void;
  /** Every projected journey the broker returned, for the screen to render. */
  onJourney?: (journey: unknown) => void;
  /** The same, for a life event that turned into several services. */
  onPlan?: (plan: unknown) => void;
  /**
   * Every tool call, as it is answered. What the screen draws from this is a
   * report of work already done on the server: nothing here decides anything,
   * and a caller editing it in devtools changes what one person sees.
   */
  onTool?: (name: string, result: ToolResult) => void;
  onError?: (message: string) => void;
  /** Place in line while waiting, and undefined the moment the wait is over. */
  onQueue?: (place: QueuePlace | undefined) => void;
  /** Once a second while connected. For a countdown, and nothing else. */
  onTime?: (remainingMs: number, maxCallMs: number) => void;
  /** A ceiling was reached. The call did not start, or has just ended. */
  onLimit?: (limit: VoiceLimit) => void;
}

export interface VoiceClientOptions extends VoiceHandlers {
  /** Where our routes live. Overridable so the mobile app can point elsewhere. */
  baseUrl?: string;
  jurisdiction?: { country?: string; state?: string; district?: string; taluka?: string };
  language?: "en" | "hi" | "gu";
}

interface StartedSession {
  sessionId: string;
  token: string;
  clientSecret: string;
  model: string;
  /**
   * How long this call gets, as decided by the server from the tier. Shown, and
   * used for nothing else: the countdown below is corrected from the server on
   * every heartbeat, and the actual stop is `expires_at` on the session row.
   * Editing this number in devtools buys a wrong number on a screen. §3.
   */
  maxCallMs: number;
  heartbeatMs: number;
  tier: "GUEST" | "AUTHENTICATED";
  /**
   * The realtime host, handed over rather than compiled in.
   *
   * On Azure AI Foundry this is the deployment's own resource, so it differs
   * per deployment and a constant here would be a constant somebody has to
   * rebuild the bundle to change. Not a secret - the browser is about to open a
   * connection to it - but it is the server's to decide.
   */
  callUrl: string;
}

export class VoiceClient {
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private audio?: HTMLAudioElement;
  private session?: StartedSession;
  private state: VoiceState = "idle";

  /**
   * Everything the broker has proven this call, accumulated.
   *
   * The output guardrail needs the whole call's grounding rather than the last
   * tool's, because a caller who asks "what was that fee again" four turns later
   * is asking about a fact that is still proven.
   */
  private grounding: SpeakableFact[] = [];
  private said = "";

  /** Queue ticket while waiting, and the clocks while connected. */
  private ticket?: string;
  private abandoned = false;
  private endsAt = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private pulse?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private warned = new Set<number>();

  /**
   * Any microphone, cleaned up by the browser rather than by us.
   *
   * A built-in laptop microphone sits a few centimetres from the speaker
   * playing Ariane's voice, so without echo cancellation the model hears
   * itself, decides the caller is talking, and interrupts its own sentence. A
   * headset on the same page is quiet and needs the gain instead. All three of
   * these run in the platform's audio thread, which is a far better place for
   * them than any DSP we could ship in a bundle.
   *
   * `ideal` and not `exact`, and no `deviceId` anywhere: a microphone that
   * cannot do one of them still connects. Naming a device is how you build a
   * panel that works on the laptop it was written on.
   */
  private static readonly AUDIO: MediaTrackConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
  };

  /**
   * How long a connected call may stay silent before we call it dead.
   *
   * The clock now starts at Ariane's first word, so a handshake that completes
   * and then produces nothing would otherwise sit on "Connecting" forever with
   * no countdown to end it.
   */
  private static readonly FIRST_WORD_MS = 20_000;

  constructor(private readonly options: VoiceClientOptions = {}) {}

  get currentState(): VoiceState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "ended" && this.state !== "error") return;
    this.abandoned = false;
    this.setState("connecting");

    try {
      /**
       * The microphone first, and before anything has been reserved.
       *
       * This used to run after `openSession`, which meant the browser's
       * permission prompt sat open on top of a guest's one paid minute already
       * ticking down. People took twenty seconds to find the Allow button and
       * were then told to sign in to keep talking, about a call that had never
       * connected. Nothing is spent until there is a working microphone to
       * spend it on.
       */
      this.mic = await this.openMic();

      let started = await this.openSession();

      /**
       * All ten lines busy. §5: take a ticket and wait, and do not open a
       * realtime session or spend anything while waiting. A queued caller costs
       * a poll every two seconds and nothing else.
       */
      if (!started) {
        // Let the microphone go while we wait. A queue can run minutes and
        // nobody wants the recording indicator lit through all of it. The
        // permission is granted by now, so taking it back is instant and
        // silent.
        this.releaseMic();
        const claimed = await this.waitInLine();
        if (!claimed) {
          this.setState("idle");
          return;
        }
        this.mic = await this.openMic();
        started = await this.openSession(claimed);
        if (!started) {
          // The slot we waited for went while we were claiming it. Rare, and
          // recoverable by trying again, which is what the button now offers.
          this.releaseMic();
          this.options.onLimit?.({ code: "CLAIM_INVALID", message: "Your place in line expired. Please try again." });
          this.setState("idle");
          return;
        }
      }

      this.session = started;
      await this.connect(started);

      /**
       * Still "connecting", deliberately, and no countdown yet.
       *
       * A peer connection is open; that is not the same as somebody being on
       * the line. The clock starts at Ariane's first word in `speaking()`
       * below, so a slow handshake comes out of our time rather than out of a
       * guest's sixty seconds. This is only the backstop for the case where
       * that word never arrives.
       */
      this.deadline = setTimeout(() => {
        if (!this.ticker) this.fail("Ariane did not pick up. Please try again.");
      }, VoiceClient.FIRST_WORD_MS);
    } catch (error) {
      if (error instanceof Refused) {
        // A ceiling is not a failure and gets no error state, but the
        // microphone we opened on the way in is still ours to put down.
        this.releaseMic();
        this.options.onLimit?.(error.limit);
        this.setState("idle");
        return;
      }
      this.fail(error instanceof Error ? error.message : "Could not start the call");
    }
  }

  /**
   * Ask for a microphone, and say something useful when there is not one.
   *
   * All four of these arrive as the same `DOMException` and, before this, as
   * the same "Could not start the call" - which is unhelpful in four different
   * ways, because the fix is a different one every time.
   */
  private async openMic(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: VoiceClient.AUDIO });
    } catch (error) {
      switch ((error as { name?: string })?.name) {
        case "NotAllowedError":
        case "SecurityError":
          throw new Error("Ariane needs your microphone. Allow it in the address bar, then try again.");
        case "NotFoundError":
        case "OverconstrainedError":
          throw new Error("No microphone found. Plug one in or pick one in your system sound settings, then try again.");
        case "NotReadableError":
          throw new Error("Something else is using your microphone. Close it and try again.");
        default:
          throw new Error("Could not open your microphone.");
      }
    }
  }

  private releaseMic(): void {
    this.mic?.getTracks().forEach((track) => track.stop());
    this.mic = undefined;
  }

  /** Stop waiting. The ticket is released so the person behind moves up. */
  leaveQueue(): void {
    this.abandoned = true;
    const ticket = this.ticket;
    this.ticket = undefined;
    if (ticket) {
      void fetch(this.base(`/api/voice/queue?ticket=${encodeURIComponent(ticket)}`), {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {
        // The ticket expires on its own. Same rule as the lease: the client is
        // an optimisation and never the mechanism.
      });
    }
    this.options.onQueue?.(undefined);
    this.setState("idle");
  }

  stop(): void {
    this.teardown();
    this.setState("ended");
  }

  /**
   * Everything down, and nothing said about what state we are in.
   *
   * Split out of `stop` because a failed call has to hang up too. It used to
   * not: `fail` set an error state and left the session open, so the line
   * stayed leased until its TTL and, for a guest, the whole minute stayed
   * charged for a call that never connected. Then they pressed the retry
   * button and were told to sign in.
   */
  private teardown(): void {
    /**
     * Tell the server first, and with `keepalive` so it survives the tab
     * closing. A session nobody hangs up holds a concurrency slot for ten
     * minutes, which on a shared demo line is the difference between the next
     * person getting a call and getting a rate limit.
     */
    if (this.session) {
      const { sessionId, token } = this.session;
      void fetch(this.base(`/api/voice/session?sessionId=${encodeURIComponent(sessionId)}`), {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {
        // Best effort. The session expires on its own either way.
      });
    }

    clearInterval(this.ticker);
    clearInterval(this.pulse);
    clearTimeout(this.deadline);
    this.ticker = undefined;
    this.pulse = undefined;
    this.deadline = undefined;
    this.warned.clear();
    this.channel?.close();
    this.pc?.close();
    this.releaseMic();
    this.audio?.remove();
    this.channel = undefined;
    this.pc = undefined;
    this.audio = undefined;
    // The session id is kept out of anything persistent on purpose. Reload the
    // page and it is a new call, which is the retention policy §19 asks for.
    this.session = undefined;
    this.grounding = [];
    this.setState("ended");
  }

  /** Cut the microphone without dropping the call. */
  setMuted(muted: boolean): void {
    this.mic?.getAudioTracks().forEach((track) => (track.enabled = !muted));
  }

  // -------------------------------------------------------------------------

  private base(path: string): string {
    return `${this.options.baseUrl ?? ""}${path}`;
  }

  /**
   * Ask for a line. Returns undefined when every line is taken, which is the
   * one refusal that has somewhere to go: the queue. Everything else is a
   * ceiling and comes back as `Refused`.
   *
   * The body carries a jurisdiction, a language and — if we waited — a ticket
   * and the claim token the server itself minted for it. There is nothing else
   * it is allowed to say. No tier, no duration, no position.
   */
  private async openSession(claim?: { ticket: string; claimToken: string }): Promise<StartedSession | undefined> {
    const response = await fetch(this.base("/api/voice/session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(this.options.jurisdiction ? { jurisdiction: this.options.jurisdiction } : {}),
        ...(this.options.language ? { language: this.options.language } : {}),
        ...(claim ?? {}),
      }),
    });

    const body = (await response.json()) as Partial<StartedSession> & {
      error?: string;
      code?: VoiceLimit["code"];
      resetAt?: number;
    };

    if (!response.ok) {
      if (body.code === "BUSY" && !claim) return undefined;
      if (body.code) throw new Refused({ code: body.code, message: body.error ?? "Voice is not available right now", resetAt: body.resetAt });
      throw new Error(body.error ?? "Voice is not available right now");
    }

    const { sessionId, token, clientSecret, model, callUrl } = body;
    if (!sessionId || !token || !clientSecret || !model || !callUrl) {
      throw new Error("Voice session was incomplete");
    }
    return {
      sessionId,
      token,
      clientSecret,
      model,
      callUrl,
      // Defaults so an older server that does not send these still connects.
      // Wrong in the direction of a shorter call, never a longer one.
      maxCallMs: body.maxCallMs ?? 60_000,
      heartbeatMs: body.heartbeatMs ?? 15_000,
      tier: body.tier ?? "GUEST",
    };
  }

  /**
   * Wait for a line. §5.
   *
   * A ticket, then a poll every couple of seconds until the server says this
   * ticket is at the front and hands over a claim token. Nothing here decides
   * anything about position: it asks, and it reports what it is told.
   */
  private async waitInLine(): Promise<{ ticket: string; claimToken: string } | undefined> {
    const joined = await fetch(this.base("/api/voice/queue"), { method: "POST" });
    if (!joined.ok) return undefined;

    const first = (await joined.json()) as { ticket?: string; position?: number; estimatedWaitMs?: number; max?: number; pollMs?: number };
    if (!first.ticket) return undefined;

    this.ticket = first.ticket;
    this.setState("queued");
    this.options.onQueue?.({ position: first.position ?? 1, estimatedWaitMs: first.estimatedWaitMs, max: first.max ?? 10 });

    const pollMs = Math.max(1_000, first.pollMs ?? 2_000);
    while (!this.abandoned) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (this.abandoned) break;

      let view: { status?: string; position?: number; estimatedWaitMs?: number; max?: number; claimToken?: string };
      try {
        const response = await fetch(this.base(`/api/voice/queue?ticket=${encodeURIComponent(first.ticket)}`));
        view = (await response.json()) as typeof view;
      } catch {
        // A dropped poll on a train is not a lost place. The ticket's TTL is
        // refreshed by the next successful one.
        continue;
      }

      if (view.status === "ADMITTED" && view.claimToken) {
        this.ticket = undefined;
        this.options.onQueue?.(undefined);
        this.setState("connecting");
        return { ticket: first.ticket, claimToken: view.claimToken };
      }
      if (view.status !== "WAITING") break;

      this.options.onQueue?.({ position: view.position ?? 1, estimatedWaitMs: view.estimatedWaitMs, max: view.max ?? 10 });
    }

    this.ticket = undefined;
    this.options.onQueue?.(undefined);
    return undefined;
  }

  /**
   * Two clocks, and neither of them is the limit. §3.
   *
   * The fast one draws a countdown once a second so the number on screen moves.
   * The slow one is the heartbeat: it tells the server this line is still in
   * use, and the server answers with how long is actually left, which is what
   * the countdown is then corrected to. That is what makes a throttled
   * background tab, a suspended laptop and a rewritten `setTimeout` all
   * harmless — the browser's opinion about time is overwritten every fifteen
   * seconds by the row in Postgres, and when the row says zero the call ends
   * whatever this file thinks.
   */
  /**
   * Ariane opened its mouth. This is where the call starts, and it is
   * deliberately not "the peer connection came up".
   *
   * A guest gets sixty seconds. Spending nine of them on an SDP round trip and
   * a model warming up is spending them on nothing the caller can use, and the
   * worst version of it - a handshake that hangs and then fails - was charging
   * the whole minute for silence. So the countdown starts at the first word.
   * The server is still the limit: `expires_at` was set at admit and the
   * heartbeat corrects this clock against it every fifteen seconds, so what
   * this buys is honesty about the start, never extra time. §3.
   */
  private speaking(): void {
    if (this.session && !this.ticker) this.startClock(this.session);
    this.setState("speaking");
  }

  private startClock(session: StartedSession): void {
    clearTimeout(this.deadline);
    this.deadline = undefined;

    this.endsAt = Date.now() + session.maxCallMs;
    this.warned.clear();

    this.ticker = setInterval(() => {
      const remaining = Math.max(0, this.endsAt - Date.now());
      this.options.onTime?.(remaining, session.maxCallMs);

      for (const at of WARN_AT_MS) {
        if (remaining <= at && !this.warned.has(at)) {
          this.warned.add(at);
          this.warn(Math.round(at / 1000));
        }
      }

      if (remaining <= 0) this.timeUp();
    }, 1_000);

    this.pulse = setInterval(() => {
      void this.heartbeat(session);
    }, session.heartbeatMs);
  }

  private async heartbeat(session: StartedSession): Promise<void> {
    try {
      const response = await fetch(
        this.base(`/api/voice/session?sessionId=${encodeURIComponent(session.sessionId)}`),
        { method: "PATCH", headers: { authorization: `Bearer ${session.token}` } },
      );
      const body = (await response.json()) as { live?: boolean; remainingMs?: number };
      if (body.live === false) {
        this.timeUp();
        return;
      }
      // Relative, not absolute: a phone whose clock is four minutes off would
      // otherwise end every call the moment it connected.
      if (typeof body.remainingMs === "number") this.endsAt = Date.now() + body.remainingMs;
    } catch {
      // The lease expires on its own if this keeps failing, and the session row
      // ends the call regardless. A dropped heartbeat is not a reason to hang
      // up on somebody mid-sentence.
    }
  }

  /** One short sentence, out loud, at thirty seconds and at ten. §3. */
  private warn(seconds: number): void {
    this.send({
      type: "response.create",
      response: {
        instructions: `Tell the caller, in one short sentence and in the language you are speaking, that about ${seconds} seconds remain on this call. Then carry on helping.`,
      },
    });
  }

  /** The end, gracefully. §3: a goodbye, then the line goes back. */
  private timeUp(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.send({
      type: "response.create",
      response: {
        instructions:
          "The time on this call is up. Say goodbye in one short sentence and tell them everything is saved on the page in front of them.",
      },
    });
    this.options.onLimit?.({ code: "TIME_UP", message: "Your time is up." });
    setTimeout(() => this.stop(), 2_500);
  }

  private async connect(session: StartedSession): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // One audio element, created here rather than expected in the DOM, so
    // mounting this in a page is a component and not a checklist.
    //
    // Attached, though, and that is not cosmetic: Safari will not play a
    // MediaStream from an element outside the document and Chrome is
    // inconsistent about it. A detached element connects, negotiates, receives
    // the track and plays nothing, which is indistinguishable from a model that
    // never answered.
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.hidden = true;
    document.body.appendChild(audio);
    this.audio = audio;
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };

    // A failed ICE negotiation is otherwise silent, and silence is the one
    // symptom this whole file cannot afford to have two causes for.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.fail("The voice connection dropped");
    };

    for (const track of this.mic?.getTracks() ?? []) pc.addTrack(track, this.mic!);

    const channel = pc.createDataChannel("realtime-channel");
    this.channel = channel;
    channel.onmessage = (event) => {
      void this.onServerEvent(event.data as string);
    };

    /**
     * Ariane speaks first.
     *
     * The realtime model waits for the caller by default, so without this the
     * line connects and then sits there. On a phone that reads as a dead line,
     * and the person hangs up before they have said the thing we could have
     * helped with. What it says is the system prompt's business, including the
     * consent line; this only decides that there is an opening turn at all.
     */
    channel.onopen = () => {
      this.send({
        type: "response.create",
        response: { instructions: "Greet the caller in one short sentence and ask what they need help with." },
      });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    /**
     * The ephemeral secret goes in the Authorization header, which is why it
     * has to be ephemeral. A permanent key here would be readable in devtools
     * by every citizen who opened the panel. §5.
     *
     * No `?model=` on the query string. The deployment was named when the
     * credential was minted, and this handshake is scoped to that credential -
     * which is the property that matters, because it means a browser cannot
     * point a session it was given at a different deployment.
     */
    const answer = await fetch(session.callUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/sdp" },
      body: offer.sdp,
    });
    // The status is the whole diagnosis when this fails: 401 is a dead
    // credential, 404 a deployment name that does not exist on the resource.
    if (!answer.ok) throw new Error(`Could not reach the voice service (${answer.status})`);

    await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
  }

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private async onServerEvent(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    /**
     * Every event type, on the debug channel and nothing else.
     *
     * A realtime call that goes quiet has half a dozen possible causes and no
     * server-side trace: the SDP handshake, the microphone, turn detection, the
     * model, the tool round trip. The type alone separates them - a call with no
     * `input_audio_buffer.speech_started` never heard the caller, and one with
     * no `response.created` after it heard them but chose not to answer. The
     * event bodies carry what the caller said, so only the type is logged. §19.
     */
    if (typeof console !== "undefined") console.debug("[voice]", event.type);

    switch (event.type) {
      case "response.output_audio_transcript.delta":
        this.said += String(event.delta ?? "");
        this.options.onTranscript?.(this.said, false);
        break;

      case "response.output_audio_transcript.done":
        this.options.onTranscript?.(String(event.transcript ?? this.said), true);
        this.checkWhatItSaid(String(event.transcript ?? this.said));
        this.postTurn("ASSISTANT", String(event.transcript ?? this.said));
        this.said = "";
        break;

      /**
       * What the caller said, and only when the deployment has turned caller
       * transcription on. Off by default, and off means the admin panel shows
       * Ariane's half of the conversation and a note that the other half was
       * never written down. §9, §17.
       */
      case "conversation.item.input_audio_transcription.completed":
        this.postTurn("USER", String(event.transcript ?? ""));
        break;

      case "input_audio_buffer.speech_started":
        // Barge-in. The model is already stopping server side; this is the UI
        // catching up so the screen does not show it talking over somebody.
        this.setState("listening");
        break;

      case "response.created":
        this.speaking();
        break;

      case "response.done":
        this.setState("listening");
        break;

      case "response.function_call_arguments.done":
        await this.relayToolCall(String(event.call_id ?? ""), String(event.name ?? ""), event.arguments);
        break;

      case "error":
        this.fail(String((event.error as { message?: string })?.message ?? "Voice error"));
        break;
    }
  }

  /**
   * A line of what was said, sent home. §9.
   *
   * Fire and forget, deliberately. The audio never touched our server — it went
   * browser to Azure over WebRTC — so this is the only path text has, and it is
   * also a path that must never be able to affect the call. Nothing awaits it,
   * nothing retries it, and a failure is silent. Redaction happens on the
   * server, because a client is not where a rule about Aadhaar numbers lives.
   */
  private postTurn(role: "USER" | "ASSISTANT", text: string): void {
    const session = this.session;
    if (!session || !text.trim()) return;
    void fetch(this.base("/api/voice/turn"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ sessionId: session.sessionId, role, text }),
      keepalive: true,
    }).catch(() => {
      // A missing line in a transcript is a gap in a log. Not a citizen's problem.
    });
  }

  /**
   * The model proposed a tool. Our server decides.
   *
   * Note what is not here: no check of the name, no branch on which tool it is,
   * no local handling of anything. Every proposal takes the same round trip
   * through the broker, so the browser has no path that skips it.
   */
  private async relayToolCall(callId: string, name: string, args: unknown): Promise<void> {
    const session = this.session;
    if (!session || !callId) return;

    let result: ToolResult;
    try {
      const response = await fetch(this.base("/api/voice/tool"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ sessionId: session.sessionId, callId, name, arguments: args }),
      });
      result = (await response.json()) as ToolResult;
    } catch {
      result = { ok: false, code: "UPSTREAM_UNAVAILABLE", speak: "I cannot check that right now." };
    }

    if (result.ok) {
      this.grounding = [...this.grounding, ...result.grounding];
      // Only some tools return a journey. `resolve_need` returns candidate
      // services, `save_preference` a status, `forget_my_data` a receipt - and
      // a panel handed one of those reads `.service.name` of undefined, which
      // in React is not a blank card but the whole page gone. The shape is
      // checked rather than the tool name because the broker owns the shapes
      // and this file is not allowed to know which tool is which.
      if (isJourney(result.data)) this.options.onJourney?.(result.data);
      else if (isPlan(result.data)) this.options.onPlan?.(result.data);
    }
    this.options.onTool?.(name, result);

    // Hand the result back and let it speak. `response.create` is what turns a
    // returned tool result into audio; without it the model waits.
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
    });
    this.send({ type: "response.create" });
  }

  /**
   * §14, on the last layer available in a browser: what it actually said.
   *
   * This is not the security boundary and cannot be - the words are already out
   * of the speaker by the time we see the transcript. It is a net for the case
   * the broker cannot cover, a model that adds a plausible fee to a real answer,
   * and the recovery is to make it correct itself out loud rather than to hide
   * the mistake.
   */
  private checkWhatItSaid(transcript: string): void {
    const verdict = checkOutput(transcript, this.grounding);
    if (verdict.ok) return;

    this.send({
      type: "response.create",
      response: {
        instructions:
          "Something you just said is not in any tool result from this call. Correct yourself in one short sentence: say you are not certain of that detail and you would rather check than guess. Do not repeat the unverified detail. Then ask what they need next.",
      },
    });
  }

  private setState(state: VoiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }

  private fail(message: string): void {
    // Hang up on the way out, which also hands back the line and settles the
    // unused part of a guest's minute. A retry button is only honest if the
    // attempt that failed gave everything back first.
    this.teardown();
    this.setState("error");
    this.options.onError?.(message);
  }
}
