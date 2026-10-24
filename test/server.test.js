import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { clientIp, createApp } from "../src/app.js";
import { createGemini } from "../src/gemini.js";
import { createRateLimiter } from "../src/rateLimit.js";

const form = { type: "wedding", who: "Aanya & Rohan", date: "", guests: 150, budget: 1500000, currency: "₹", city: "Delhi", vibe: "garden", notes: "" };
const plan = { title: "T", summary: "S", budget: [{ category: "A", percent: 100, tip: "" }], timeline: [{ when: "Now", tasks: ["x"] }], vendors: [{ category: "V", items: ["i"] }], ideas: [], tips: [] };
const ok = (body = plan) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof body === "string" ? body : JSON.stringify(body) }] } }] }), { status: 200 });
const fail = (status) => new Response("{}", { status });

async function start({ env = { GEMINI_API_KEY: "test" }, replies = [], max = 100 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return replies.length ? replies.shift() : ok();
  };
  const gemini = createGemini({ env, fetchImpl, sleep: async () => {}, log: () => {} });
  const server = http.createServer(createApp({ env, gemini, limiter: createRateLimiter({ max }) }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((resolve) => server.close(resolve)) };
}
const post = (url, body) => fetch(`${url}/api/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rawStatus = (url, path) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
});

test("serves the app with security headers", async () => {
  const s = await start();
  const res = await fetch(s.url);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes("Plan·it"));
  assert.ok(res.headers.get("content-security-policy").includes("default-src 'self'"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("strict-transport-security"));
  await s.close();
});

test("blocks path traversal and non-public file types", async () => {
  const s = await start();
  for (const path of ["/../server.js", "/%2e%2e/server.js", "/..%2fserver.js", "/package.json"]) {
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
  const big = await post(s.url, { form, change: "x".repeat(40_000) });
  assert.equal(big.status, 413);
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
  const first = await (await post(s.url, { form })).json();
  const second = await (await post(s.url, { form })).json();
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
  const res = await (await post(s.url, { form })).json();
  assert.equal(res.model, "gemini-3.1-flash-lite");
  assert.equal(s.calls.length, 3);
  await s.close();
});

test("turns upstream and parsing failures into friendly errors", async () => {
  let s = await start({ replies: [fail(401)] });
  const rejected = await post(s.url, { form });
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).error, /key was rejected/);
  await s.close();
  s = await start({ replies: [ok("not json at all")] });
  assert.equal((await post(s.url, { form })).status, 502);
  await s.close();
});

test("rate limits each client", async () => {
  const s = await start({ max: 2 });
  const statuses = [];
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
  const req = { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "::1" } };
  assert.equal(clientIp(req, { RENDER: "true" }), "1.2.3.4");
  assert.equal(clientIp(req, {}), "::1");
});
