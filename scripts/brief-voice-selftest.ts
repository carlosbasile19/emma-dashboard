/* Offline checks for lib/brief/voice.ts — the browser half of the WebRTC voice briefing — driven
 * with fake getUserMedia / RTCPeerConnection / audio. Also asserts the briefing code path no longer
 * references Retell (reporting still uses it; that path is excluded). `npm run test:briefvoice` */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  connectBriefingVoice,
  type BriefStartResult,
  type VoiceDeps,
  type VoiceStopReason,
} from "../lib/brief/voice";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=offer\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=answer\r\n";

function harness(opts: {
  start?: (sdp: string) => Promise<BriefStartResult>;
  micDenied?: boolean;
  remoteFails?: boolean;
  playRejects?: boolean;
  expiresInMs?: number;
} = {}) {
  const log: string[] = [];
  const ended: string[] = [];
  const stops: VoiceStopReason[] = [];
  const timers: Array<() => void> = [];
  let blocked = 0;
  let playRejects = opts.playRejects ?? false;
  const track = {
    kind: "audio",
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
      log.push("track.stop");
    },
  };
  const mic = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const pc = {
    connectionState: "new",
    closed: false,
    ontrack: null as null | ((e: unknown) => void),
    onconnectionstatechange: null as null | (() => void),
    addTrack(t: unknown, s: unknown) {
      assert.equal(t, track);
      assert.equal(s, mic);
      log.push("addTrack");
    },
    createDataChannel(label: string) {
      log.push(`dataChannel:${label}`);
      return {};
    },
    async createOffer() {
      log.push("createOffer");
      return { type: "offer", sdp: OFFER };
    },
    async setLocalDescription(d: { sdp: string }) {
      log.push(`setLocal:${d.sdp === OFFER}`);
    },
    async setRemoteDescription(d: { type: string; sdp: string }) {
      log.push(`setRemote:${d.type}:${d.sdp === ANSWER}`);
      if (opts.remoteFails) throw new Error("bad answer");
    },
    close() {
      this.closed = true;
      log.push("pc.close");
    },
  };
  const audio = {
    srcObject: null as unknown,
    play: () => {
      log.push("play");
      return playRejects ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
    },
    pause: () => {},
  };
  const ac = new AbortController();
  const deps: VoiceDeps = {
    getUserMedia: async (c) => {
      assert.deepEqual(c, { audio: true });
      log.push("getUserMedia");
      if (opts.micDenied) throw new Error("NotAllowedError");
      return mic;
    },
    createPeerConnection: () => {
      log.push("newPC");
      return pc as unknown as RTCPeerConnection;
    },
    start:
      opts.start ??
      (async (sdp) => {
        log.push(`start:${sdp === OFFER}`);
        return {
          mode: "live",
          briefingId: "brf_1",
          realtime: {
            provider: "openai",
            transport: "webrtc",
            sdp: ANSWER,
            expires_at: new Date(1_000_000 + (opts.expiresInMs ?? 900_000)).toISOString(),
          },
        };
      }),
    end: async (id) => {
      ended.push(id);
    },
    audio: audio as unknown as HTMLAudioElement,
    signal: ac.signal,
    onAudioBlocked: () => blocked++,
    onStopped: (r) => stops.push(r),
    now: () => 1_000_000,
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: (t) => {
      timers[(t as number) - 1] = () => {};
    },
  };
  return {
    deps, log, ended, stops, timers, track, pc, audio, ac,
    get blocked() { return blocked; },
    setPlayRejects: (v: boolean) => (playRejects = v),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // ---- happy path: mic → track → data channel → offer → backend → answer ----
  {
    const h = harness();
    const r = await connectBriefingVoice(h.deps);
    assert.equal(r.kind, "live");
    assert.deepEqual(h.log, [
      "getUserMedia",
      "newPC",
      "addTrack",
      "dataChannel:oai-events",
      "createOffer",
      "setLocal:true",
      "start:true",
      "setRemote:answer:true",
    ]);
    assert.ok(h.log.indexOf("addTrack") < h.log.indexOf("createOffer"), "offer made after the mic track is added");

    // remote audio → <audio>.srcObject + play()
    const stream = { id: "remote" };
    h.pc.ontrack!({ streams: [stream], track: {} });
    assert.equal(h.audio.srcObject, stream);
    assert.ok(h.log.includes("play"));

    // mute toggles the mic track without renegotiating
    if (r.kind === "live") {
      r.handle.setMuted(true);
      assert.equal(h.track.enabled, false);
      r.handle.setMuted(false);
      assert.equal(h.track.enabled, true);

      // user ends: /end + pc.close() + track.stop(), exactly once
      r.handle.close();
      r.handle.close();
    }
    assert.deepEqual(h.ended, ["brf_1"]);
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
    assert.equal(h.log.filter((l) => l === "pc.close").length, 1);
    assert.equal(h.audio.srcObject, null);
    assert.deepEqual(h.stops, [], "a user close is not reported as an unexpected stop");
  }

  // ---- autoplay refused: show the control, keep the connection, retry on click ----
  {
    const h = harness({ playRejects: true });
    const r = await connectBriefingVoice(h.deps);
    h.pc.ontrack!({ streams: [{}], track: {} });
    await flush();
    assert.equal(h.blocked, 1);
    assert.equal(h.pc.closed, false, "autoplay rejection keeps the connection alive");
    h.setPlayRejects(false);
    assert.ok(r.kind === "live" && (await r.handle.retryPlay()));
    if (r.kind === "live") r.handle.close();
  }

  // ---- pc.connectionState === "failed" → end + close + stop, reported for the retry notice ----
  {
    const h = harness();
    await connectBriefingVoice(h.deps);
    h.pc.connectionState = "failed";
    h.pc.onconnectionstatechange?.();
    assert.deepEqual(h.stops, ["connection_failed"]);
    assert.deepEqual(h.ended, ["brf_1"]);
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
  }

  // ---- expires_at → end + close + stop ----
  {
    const h = harness({ expiresInMs: 5000 });
    await connectBriefingVoice(h.deps);
    assert.equal(h.timers.length, 1);
    h.timers[0]!();
    assert.deepEqual(h.stops, ["expired"]);
    assert.deepEqual(h.ended, ["brf_1"]);
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
  }

  // ---- closing clears the expiry timer (no late "expired" after a user close) ----
  {
    const h = harness();
    const r = await connectBriefingVoice(h.deps);
    if (r.kind === "live") r.handle.close();
    h.timers[0]!();
    assert.deepEqual(h.stops, []);
  }

  // ---- mic denied → walkthrough, no peer connection, nothing to end ----
  {
    const h = harness({ micDenied: true });
    const r = await connectBriefingVoice(h.deps);
    assert.deepEqual(r, { kind: "fallback", reason: "mic_denied" });
    assert.ok(!h.log.includes("newPC"));
    assert.deepEqual(h.ended, []);
  }

  // ---- Olivia refused (e.g. 429 concurrency) → close + stop, error passed through ----
  {
    const refused: BriefStartResult = {
      mode: "simulated",
      error: { code: "briefing_concurrency_limit", message: "busy", retryAfterSeconds: 30 },
    };
    const h = harness({ start: async () => refused });
    const r = await connectBriefingVoice(h.deps);
    assert.deepEqual(r, { kind: "fallback", reason: "refused", session: refused });
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
    assert.deepEqual(h.ended, [], "no briefing was created, so nothing to end");
  }

  // ---- the answer can't be applied → /end the created briefing, close, stop ----
  {
    const h = harness({ remoteFails: true });
    const r = await connectBriefingVoice(h.deps);
    assert.equal(r.kind, "fallback");
    assert.deepEqual(h.ended, ["brf_1"]);
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
  }

  // ---- the backend call throws → close + stop ----
  {
    const h = harness({ start: async () => { throw new Error("network"); } });
    const r = await connectBriefingVoice(h.deps);
    assert.equal(r.kind, "fallback");
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
  }

  // ---- modal closed while the backend call is in flight → cancelled, created briefing ended ----
  {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness({
      start: async () => {
        await gate;
        return {
          mode: "live",
          briefingId: "brf_2",
          realtime: { provider: "openai", transport: "webrtc", sdp: ANSWER },
        };
      },
    });
    const pending = connectBriefingVoice(h.deps);
    await flush();
    h.ac.abort();
    release();
    assert.deepEqual(await pending, { kind: "cancelled" });
    assert.deepEqual(h.ended, ["brf_2"]);
    assert.equal(h.pc.closed, true);
    assert.equal(h.track.stopped, true);
    assert.ok(!h.log.some((l) => l.startsWith("setRemote")), "no answer applied after cancel");
  }

  // ---- modal closed while waiting on the mic prompt → cancelled, mic stopped ----
  {
    const h = harness();
    h.ac.abort();
    assert.deepEqual(await connectBriefingVoice(h.deps), { kind: "cancelled" });
    assert.equal(h.track.stopped, true);
    assert.ok(!h.log.includes("newPC"));
  }

  // ---- no Retell anywhere on the briefing path (reporting keeps it) ----
  for (const f of [
    "components/dashboard/brief/BriefEmma.tsx",
    "components/dashboard/brief/useBriefingStream.ts",
    "lib/brief/voice.ts",
    "app/api/briefing/[id]/route.ts",
    "app/api/briefing/[id]/stream/route.ts",
  ]) {
    assert.ok(!/retell/i.test(readFileSync(f, "utf8")), `${f} must not reference Retell`);
  }
  const api = readFileSync("lib/olivia/api.ts", "utf8");
  const briefApi = api.slice(api.indexOf("// ---- Briefing bridge"), api.indexOf("// ---- Reporting bridge"));
  assert.ok(briefApi.length > 0 && !/retell|ice_servers|\btoken\b|\broom\b/i.test(briefApi), "briefing API types carry no Retell/token fields");
  assert.ok(/retell-client-js-sdk/.test(readFileSync("components/dashboard/report/ReportEmma.tsx", "utf8")), "reporting still uses Retell");

  console.log("brief-voice-selftest: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
