import test, { mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { clientIp, createApp } from "../src/app.ts";
import { createGemini, type Env } from "../src/gemini.ts";
import { createRateLimiter } from "../src/rateLimit.ts";
import type { EventForm, Plan } from "../public/planner.ts";

const form: EventForm = { type: "wedding", who: "Aanya & Rohan", date: "", guests: 150, budget: 1500000, currency: "₹", city: "Delhi", vibe: "garden", notes: "" };
const plan: Plan = { title: "T", summary: "S", budget: [{ category: "A", percent: 100, tip: "" }], timeline: [{ when: "Now", tasks: ["x"] }], vendors: [{ category: "V", items: ["i"] }], ideas: [], tips: [] };

type Reply = Response | Error;
const ok = (body: unknown = plan): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof body === "string" ? body : JSON.stringify(body) }] } }] }));
const fail = (status: number): Response => new Response("{}", { status });

type StartOptions = { env?: Env; replies?: Reply[]; max?: number; discover?: boolean };

async function start({ env = { GEMINI_API_KEY: "test" }, replies = [], max = 100, discover = false }: StartOptions = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next ?? ok();
  };
  const gemini = createGemini({ env, fetchImpl, sleep: async () => {}, log: () => {}, discover });
  const server = http.createServer(createApp({ env, gemini, limiter: createRateLimiter({ max }) }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const post = (url: string, body: unknown) =>
  fetch(`${url}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rawStatus = (url: string, path: string) =>
  new Promise<number | undefined>((resolve, reject) => {
    const target = new URL(url);
    http.get({ host: target.hostname, port: target.port, path }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject);
  });
const modelOf = async (res: Response) => ((await res.json()) as Plan).model;

test("serves the app with security headers", async () => {
  const s = await start();
  const res = await fetch(s.url);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes("Plan·it"));
  assert.ok(res.headers.get("content-security-policy")?.includes("default-src 'self'"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("strict-transport-security"));
  await s.close();
});

test("serves TypeScript to the browser as plain JavaScript", async () => {
  const s = await start();
  const res = await fetch(`${s.url}/app.ts`);
  assert.match(res.headers.get("content-type") ?? "", /javascript/);
  const code = await res.text();
  assert.ok(code.includes("generate"));
  assert.ok(!/:\s*(string|number|HTMLElement)\b/.test(code), "type annotations should be stripped");
  await s.close();
});

test("blocks path traversal and non-public file types", async () => {
  const s = await start();
  for (const path of ["/../server.ts", "/%2e%2e/server.ts", "/..%2fserver.ts", "/package.json"]) {
    assert.equal(await rawStatus(s.url, path), 404, path);
  }
  await s.close();
});

test("rejects requests that are not valid", async () => {
  const s = await start();
  assert.equal((await post(s.url, { form: { ...form, guests: 1 } })).status, 400);
  const bad = await fetch(`${s.url}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
  const wrongType = await fetch(`${s.url}/api/plan`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" });
  assert.equal(wrongType.status, 415);
  assert.equal((await post(s.url, { form, change: "x".repeat(40_000) })).status, 413);
  assert.equal((await post(s.url, { form, change: "cut budget", plan: { nope: true } })).status, 400);
  assert.equal((await fetch(`${s.url}/api/plan`)).status, 404);
  assert.equal((await fetch(s.url, { method: "DELETE" })).status, 405);
  await s.close();
});

test("reports a missing AI key", async () => {
  const s = await start({ env: {} });
  assert.equal((await post(s.url, { form })).status, 503);
  await s.close();
});

test("returns a plan, names the model and caches identical requests", async () => {
  const s = await start();
  const first = (await (await post(s.url, { form })).json()) as Plan;
  const second = (await (await post(s.url, { form })).json()) as Plan;
  assert.equal(first.title, "T");
  assert.equal(first.model, "gemini-3.5-flash");
  assert.deepEqual(second, first);
  assert.equal(s.calls.length, 1);
  await s.close();
});

test("tweaking a plan sends the requested change to the model", async () => {
  const s = await start();
  const res = await post(s.url, { form, plan, change: "cut the budget 15%" });
  assert.equal(res.status, 200);
  assert.ok(s.calls[0].body.includes("cut the budget 15%"));
  await s.close();
});

test("falls back to the next free model when one is overloaded or out of quota", async () => {
  const s = await start({ replies: [fail(503), fail(429), ok()] });
  assert.equal(await modelOf(await post(s.url, { form })), "gemini-3.1-flash-lite");
  assert.equal(s.calls.length, 3);
  await s.close();
});

test("uses the newest Flash model Google offers to this key", async () => {
  const models = new Response(JSON.stringify({ models: [
    { name: "models/gemini-9.9-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-9.9-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-9.8-flash-preview", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-9.9-flash-image", supportedGenerationMethods: ["generateContent"] },
  ] }));
  const s = await start({ discover: true, replies: [models, ok()] });
  assert.equal(await modelOf(await post(s.url, { form })), "gemini-9.9-flash");
  assert.ok(s.calls[1].url.includes("gemini-9.9-flash"));
  await s.close();
});

test("keeps working when model discovery fails", async () => {
  const s = await start({ discover: true, replies: [fail(500), ok()] });
  assert.equal(await modelOf(await post(s.url, { form })), "gemini-3.5-flash");
  await s.close();
});

test("tries the configured model first", async () => {
  const s = await start({ env: { GEMINI_API_KEY: "test", GEMINI_MODEL: "custom-flash" } });
  await post(s.url, { form });
  assert.ok(s.calls[0].url.includes("custom-flash"));
  await s.close();
});

test("turns upstream and parsing failures into friendly errors", async () => {
  let s = await start({ replies: [fail(401)] });
  const rejected = await post(s.url, { form });
  assert.equal(rejected.status, 502);
  assert.match(((await rejected.json()) as { error: string }).error, /key was rejected/);
  await s.close();
  s = await start({ replies: [ok("not json at all")] });
  assert.equal((await post(s.url, { form })).status, 502);
  await s.close();
});

test("reports when every model is out of quota or still overloaded after retries", async () => {
  let s = await start({ replies: [fail(429), fail(429), fail(429), fail(429)] });
  const busy = await post(s.url, { form });
  assert.equal(busy.status, 502);
  assert.match(((await busy.json()) as { error: string }).error, /busy/);
  await s.close();
  s = await start({ replies: Array.from({ length: 12 }, () => fail(503)) });
  const overloaded = await post(s.url, { form });
  assert.match(((await overloaded.json()) as { error: string }).error, /overloaded/);
  assert.equal(s.calls.length, 12);
  await s.close();
});

test("answers HEAD requests and maps timeouts and unexpected failures", async () => {
  let s = await start();
  assert.equal((await fetch(s.url, { method: "HEAD" })).status, 200);
  await s.close();
  s = await start({ replies: [Object.assign(new Error("slow"), { name: "TimeoutError" })] });
  assert.equal((await post(s.url, { form })).status, 504);
  await s.close();
  const quiet = mock.method(console, "error", () => {});
  try {
    s = await start({ replies: [new Error("boom")] });
    assert.equal((await post(s.url, { form })).status, 500);
    await s.close();
  } finally {
    quiet.mock.restore();
  }
});

test("rate limits each client", async () => {
  const s = await start({ max: 2 });
  const statuses: number[] = [];
  for (let i = 0; i < 3; i++) statuses.push((await post(s.url, { form: { ...form, guests: 1 } })).status);
  assert.deepEqual(statuses, [400, 400, 429]);
  await s.close();
});

test("rate limiter resets after its window", () => {
  let t = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([limiter.isLimited("a"), limiter.isLimited("a"), limiter.isLimited("a"), limiter.isLimited("b")], [false, false, true, false]);
  t = 1500;
  assert.equal(limiter.isLimited("a"), false);
});

test("clientIp trusts the forwarded address only behind a proxy", () => {
  const req = { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "::1" } } as unknown as Parameters<typeof clientIp>[0];
  assert.equal(clientIp(req, { RENDER: "true" }), "1.2.3.4");
  assert.equal(clientIp(req, {}), "::1");
});
