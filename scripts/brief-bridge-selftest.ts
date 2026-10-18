/* Offline checks for the backend half of the WebRTC voice briefing (lib/olivia/service.ts →
 * api.ts → client.ts): the offer SDP is forwarded with the agency key, Olivia's SDP answer comes
 * back, and errors surface with their codes. fetch is stubbed; nothing leaves the machine.
 * service.ts is server-only, so this runs with react-server conditions (`npm run test:briefbridge`). */
import assert from "node:assert/strict";

const KEY = "oa_test_key_never_leaves_the_server";
process.env.OLIVIA_API_KEY = KEY;
process.env.OLIVIA_API_BASE = "https://olivia.test";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=offer\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=answer\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const PERIOD = { from: "2026-10-01", to: "2026-10-18", tz: "America/New_York" };

interface Call {
  url: string;
  init: RequestInit;
}
let calls: Call[] = [];
let respond: (c: Call) => Response = () => new Response("{}");
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const c = { url: String(url), init };
  calls.push(c);
  return respond(c);
}) as typeof fetch;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const logged: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => logged.push(a.map(String).join(" "));

async function main() {
  const { startBriefingFor } = await import("../lib/olivia/service");

  // ---- forwards the offer with the agency key; returns the answer ----
  calls = [];
  respond = () =>
    json(201, {
      briefing_id: "brf_1",
      client_id: "c1",
      status: "connecting",
      period: PERIOD,
      agenda: [{ id: "bookings", category: "bookings", title: "3 to confirm" }],
      realtime: { provider: "openai", transport: "webrtc", sdp: ANSWER, expires_at: "2026-10-18T12:15:00Z" },
    });
  const live = await startBriefingFor("c1", PERIOD, "all", OFFER);
  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.equal(c.url, "https://olivia.test/api/external/v1/clients/c1/briefings");
  assert.equal(c.init.method, "POST");
  assert.equal((c.init.headers as Record<string, string>)["x-api-key"], KEY);
  assert.equal(c.init.cache, "no-store", "the answer is never written to a shared cache");
  assert.deepEqual(JSON.parse(String(c.init.body)), { ...PERIOD, focus: "all", voice: true, sdp: OFFER });
  assert.equal(live.mode, "live");
  assert.equal(live.briefingId, "brf_1");
  assert.equal(live.realtime?.sdp, ANSWER);
  assert.ok(!JSON.stringify(live).includes(KEY), "the key never appears in what the browser receives");

  // ---- missing / too-short sdp → invalid_request, and Olivia is never called ----
  for (const bad of ["", "v=0", undefined as unknown as string]) {
    calls = [];
    const r = await startBriefingFor("c1", PERIOD, "all", bad);
    assert.equal(r.mode, "simulated");
    assert.equal(r.error?.code, "invalid_request");
    assert.equal(calls.length, 0);
  }

  // ---- Olivia's own 400 invalid_request is surfaced ----
  respond = () => json(400, { error: "sdp is required when voice is true", code: "invalid_request" });
  const bad = await startBriefingFor("c1", PERIOD, "all", OFFER);
  assert.deepEqual(bad.error, {
    code: "invalid_request",
    message: "sdp is required when voice is true",
    retryAfterSeconds: undefined,
  });

  // ---- 429 briefing_concurrency_limit: surfaced with Retry-After, never retried (one-shot offer) ----
  calls = [];
  respond = () =>
    json(429, { error: "Too many live briefings", code: "briefing_concurrency_limit" }, { "retry-after": "30" });
  const busy = await startBriefingFor("c1", PERIOD, "all", OFFER);
  assert.equal(calls.length, 1, "the start is not auto-retried");
  assert.equal(busy.error?.code, "briefing_concurrency_limit");
  assert.equal(busy.error?.retryAfterSeconds, 30);

  // ---- 500: OpenAI voice not configured / refused the offer ----
  respond = () => json(500, { error: "OpenAI refused the offer", code: "internal_error" });
  assert.equal((await startBriefingFor("c1", PERIOD, "all", OFFER)).error?.code, "internal_error");

  // ---- 201 without an answer → walkthrough, and the orphaned session is ended ----
  calls = [];
  respond = (call) =>
    call.url.endsWith("/end")
      ? json(200, { status: "ended" })
      : json(201, { briefing_id: "brf_2", client_id: "c1", status: "connecting" });
  const noAnswer = await startBriefingFor("c1", PERIOD, "all", OFFER);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(noAnswer.mode, "simulated");
  assert.ok(calls.some((x) => x.url.endsWith("/clients/c1/briefings/brf_2/end") && x.init.method === "POST"));

  // ---- nothing sensitive is logged ----
  const all = logged.join("\n");
  for (const secret of [KEY, OFFER, ANSWER]) assert.ok(!all.includes(secret), "logs carry no key or SDP");

  console.warn = warn;
  console.log("brief-bridge-selftest: OK");
}

main().catch((e) => {
  console.warn = warn;
  console.error(e);
  process.exit(1);
});
