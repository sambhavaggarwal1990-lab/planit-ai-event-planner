import test from "node:test";
import assert from "node:assert/strict";
import { requestPlan } from "../public/js/api.ts";
import type { EventForm, Plan } from "../public/planner.ts";

const form: EventForm = { type: "wedding", who: "", date: "", guests: 2, budget: 1000, currency: "$", city: "", vibe: "", notes: "" };
const plan: Plan = { title: "T", summary: "", budget: [], timeline: [], vendors: [], ideas: [], tips: [] };
const answer = (body: unknown, status = 200): typeof fetch => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("posts the form and only sends the current plan when revising", async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ title: "T" }));
  };
  assert.equal((await requestPlan({ form, plan, change: "" }, fetchImpl)).title, "T");
  assert.equal(sent[0].url, "/api/plan");
  assert.equal("plan" in sent[0].body, false);
  await requestPlan({ form, plan, change: "cut the budget" }, fetchImpl);
  assert.deepEqual(sent[1].body.plan, plan);
});

test("turns server errors into readable messages", async () => {
  await assert.rejects(requestPlan({ form }, answer({ error: "AI is busy." }, 429)), /AI is busy/);
  await assert.rejects(requestPlan({ form }, answer({ errors: ["One.", "Two."] }, 400)), /One\. Two\./);
  await assert.rejects(requestPlan({ form }, answer("<html>bad gateway</html>", 502)), /Request failed \(502\)/);
});
