import { checkOutput } from "./guardrails";
import type { SpeakableFact, ToolResult } from "./types";

/**
 * The browser leg, client side. `@ariane/voice/client`.
 *
 * No secrets, no Node, no Supabase. It asks our server for an ephemeral
 * credential, opens WebRTC straight to OpenAI so interruption feels immediate,
 * and relays every tool call the model proposes back to our server, which is
 * the only thing allowed to decide whether the call happens.
 *
 * What this file deliberately does not do: decide anything. It does not check a
 * tool name, does not filter arguments, does not know the policy table. A
 * tampered copy of this file gets exactly the same refusals, because the broker
 * is on the other side of the network.
 */

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "ended" | "error";

export interface VoiceHandlers {
  onState?: (state: VoiceState) => void;
  /** Assistant's own words, as it says them. Only shown; never stored by us. */
  onTranscript?: (text: string, final: boolean) => void;
  /** Every projected journey the broker returned, for the screen to render. */
  onJourney?: (journey: unknown) => void;
  onTool?: (name: string, result: ToolResult) => void;
  onError?: (message: string) => void;
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
}

const REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

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

  constructor(private readonly options: VoiceClientOptions = {}) {}

  get currentState(): VoiceState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "ended" && this.state !== "error") return;
    this.setState("connecting");

    try {
      this.session = await this.openSession();
      // Ask before connecting anything: a permission prompt that appears after
      // a peer connection is open is a permission prompt nobody understands.
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.connect(this.session);
      this.setState("listening");
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not start the call");
    }
  }

  stop(): void {
    this.channel?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach((track) => track.stop());
    this.audio?.remove();
    this.channel = undefined;
    this.pc = undefined;
    this.mic = undefined;
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

  private async openSession(): Promise<StartedSession> {
    const response = await fetch(this.base("/api/voice/session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(this.options.jurisdiction ? { jurisdiction: this.options.jurisdiction } : {}),
        ...(this.options.language ? { language: this.options.language } : {}),
      }),
    });
    const body = (await response.json()) as Partial<StartedSession> & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Voice is not available right now");
    const { sessionId, token, clientSecret, model } = body;
    if (!sessionId || !token || !clientSecret || !model) throw new Error("Voice session was incomplete");
    return { sessionId, token, clientSecret, model };
  }

  private async connect(session: StartedSession): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // One audio element, created here rather than expected in the DOM, so
    // mounting this in a page is a component and not a checklist.
    const audio = document.createElement("audio");
    audio.autoplay = true;
    this.audio = audio;
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? null;
    };

    for (const track of this.mic?.getTracks() ?? []) pc.addTrack(track, this.mic!);

    const channel = pc.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = (event) => {
      void this.onServerEvent(event.data as string);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    /**
     * The ephemeral secret goes in the Authorization header, which is why it
     * has to be ephemeral. A permanent key here would be readable in devtools
     * by every citizen who opened the panel. §5.
     */
    const answer = await fetch(`${REALTIME_URL}?model=${encodeURIComponent(session.model)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/sdp" },
      body: offer.sdp,
    });
    if (!answer.ok) throw new Error("Could not reach the voice service");

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

    switch (event.type) {
      case "response.output_audio_transcript.delta":
        this.said += String(event.delta ?? "");
        this.options.onTranscript?.(this.said, false);
        break;

      case "response.output_audio_transcript.done":
        this.options.onTranscript?.(String(event.transcript ?? this.said), true);
        this.checkWhatItSaid(String(event.transcript ?? this.said));
        this.said = "";
        break;

      case "input_audio_buffer.speech_started":
        // Barge-in. The model is already stopping server side; this is the UI
        // catching up so the screen does not show it talking over somebody.
        this.setState("listening");
        break;

      case "response.created":
        this.setState("speaking");
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
      this.options.onJourney?.(result.data);
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
    this.setState("error");
    this.options.onError?.(message);
  }
}
