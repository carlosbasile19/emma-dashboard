// Browser side of the voice briefing: an OpenAI GPT Live session over WebRTC, brokered by our
// backend (Olivia PR #589). The browser makes the offer, our server action forwards its SDP to
// Olivia with the agency key, and Olivia's SDP answer comes back. Framework-free and dependency-
// injected so scripts/brief-voice-selftest.ts can drive it with fake media + peer connections.

/** The slice of the server's BriefSession this flow reads (service.ts is server-only). */
export interface BriefStartResult {
  mode: "live" | "simulated";
  briefingId?: string;
  realtime?: { provider: string; transport: string; sdp: string; expires_at?: string };
  error?: { code: string; message: string; retryAfterSeconds?: number };
}

/** Why a connected session stopped on its own (a user-initiated close reports nothing). */
export type VoiceStopReason = "connection_failed" | "expired";

export interface VoiceDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: () => RTCPeerConnection;
  /** Our backend: forwards the offer SDP to Olivia, returns Olivia's JSON. */
  start: (offerSdp: string) => Promise<BriefStartResult>;
  /** Our backend: POST …/briefings/{id}/end (idempotent). */
  end: (briefingId: string) => Promise<void>;
  audio: HTMLAudioElement;
  /** Aborted when the modal closes mid-connect; every await re-checks it. */
  signal: AbortSignal;
  /** Autoplay rejected — show a "turn on audio" control that calls handle.retryPlay(). */
  onAudioBlocked: () => void;
  /** The session stopped without the user asking (already torn down + ended). */
  onStopped: (reason: VoiceStopReason) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface VoiceHandle {
  briefingId: string;
  /** Ends the briefing (/end), closes the peer connection and stops the mic. Idempotent. */
  close: () => void;
  setMuted: (muted: boolean) => void;
  /** Retry audio playback from a user gesture; resolves true when it plays. */
  retryPlay: () => Promise<boolean>;
}

export type VoiceConnectResult =
  | { kind: "live"; handle: VoiceHandle }
  /** No live audio: mic denied, Olivia refused, bad answer — run the walkthrough. */
  | { kind: "fallback"; reason: "mic_denied" | "refused" | "negotiation_failed"; session?: BriefStartResult }
  | { kind: "cancelled" };

export async function connectBriefingVoice(deps: VoiceDeps): Promise<VoiceConnectResult> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const now = deps.now ?? Date.now;

  let mic: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let briefingId: string | null = null;
  let expiry: unknown = null;
  let closed = false;

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (expiry !== null) clearTimer(expiry);
    if (briefingId) deps.end(briefingId).catch(() => {});
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    mic?.getTracks().forEach((t) => t.stop());
    deps.audio.pause();
    deps.audio.srcObject = null;
  };

  // 1. The mic comes first: Emma supports barge-in, and the server treats the first mic frame
  //    as "audio connected", so the track must be on the offer.
  try {
    mic = await deps.getUserMedia({ audio: true });
  } catch {
    return { kind: "fallback", reason: "mic_denied" };
  }
  if (deps.signal.aborted) {
    teardown();
    return { kind: "cancelled" };
  }

  const play = () =>
    deps.audio.play().then(
      () => true,
      () => {
        if (!closed) deps.onAudioBlocked();
        return false;
      },
    );

  let session: BriefStartResult;
  try {
    // 2. Peer connection: mic track, the transport's required data channel, remote audio out.
    pc = deps.createPeerConnection();
    const track = mic.getAudioTracks()[0];
    if (!track) throw new Error("no microphone track");
    pc.addTrack(track, mic);
    pc.createDataChannel("oai-events"); // required by the transport; we never send on it
    pc.ontrack = (e) => {
      deps.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void play();
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (deps.signal.aborted) {
      teardown();
      return { kind: "cancelled" };
    }

    // 3. Our backend forwards the offer to Olivia with the agency key.
    session = await deps.start(offer.sdp ?? "");
  } catch {
    teardown();
    return { kind: "fallback", reason: "negotiation_failed" };
  }
  briefingId = session.briefingId ?? null;
  if (deps.signal.aborted) {
    teardown();
    return { kind: "cancelled" };
  }
  if (session.mode !== "live" || !session.realtime?.sdp || !briefingId) {
    teardown();
    return { kind: "fallback", reason: "refused", session };
  }

  // 4. Apply Olivia's answer. Emma starts speaking on the first mic frame (or ~4s after attach).
  try {
    await pc.setRemoteDescription({ type: "answer", sdp: session.realtime.sdp });
  } catch {
    teardown();
    return { kind: "fallback", reason: "negotiation_failed", session };
  }
  if (deps.signal.aborted) {
    teardown();
    return { kind: "cancelled" };
  }

  const stop = (reason: VoiceStopReason) => {
    if (closed) return;
    teardown();
    deps.onStopped(reason);
  };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === "failed") stop("connection_failed");
  };
  const expiresAt = session.realtime.expires_at ? Date.parse(session.realtime.expires_at) : NaN;
  if (Number.isFinite(expiresAt)) {
    expiry = setTimer(() => stop("expired"), Math.max(0, expiresAt - now()));
  }

  const id = briefingId;
  return {
    kind: "live",
    handle: {
      briefingId: id,
      close: teardown,
      setMuted: (muted) => mic?.getAudioTracks().forEach((t) => (t.enabled = !muted)),
      retryPlay: () => (closed ? Promise.resolve(false) : play()),
    },
  };
}
