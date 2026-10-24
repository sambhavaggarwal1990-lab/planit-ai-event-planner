import test from "node:test";
import assert from "node:assert/strict";
import { TYPES, validateForm, normalizeBudget, parsePlan, buildPrompt, fallbackPlan } from "../public/planner.js";

const form = { type: "wedding", who: "Aanya & Rohan", date: "", guests: 150, budget: 1500000, currency: "₹", city: "Delhi", vibe: "garden", notes: "vegetarian" };
const sample = { title: "T", budget: [{ category: "A", percent: 100 }], timeline: [{ when: "Now", tasks: ["x"] }], vendors: [{ category: "V", items: ["i"] }] };

test("validateForm accepts a complete form", () => {
  assert.deepEqual(validateForm(form), []);
});

test("validateForm rejects bad input", () => {
  assert.equal(validateForm({ ...form, guests: 1 }).length, 1);
  assert.equal(validateForm({ ...form, budget: -5 }).length, 1);
  assert.equal(validateForm({ ...form, type: "party" }).length, 1);
  assert.equal(validateForm({ ...form, currency: "X" }).length, 1);
  assert.equal(validateForm({ ...form, notes: "x".repeat(301) }).length, 1);
});

test("normalizeBudget scales percentages to the total", () => {
  const rows = normalizeBudget([{ category: "A", percent: 60 }, { category: "B", percent: 20 }], 1000);
  assert.deepEqual(rows.map((r) => r.amount), [750, 250]);
  assert.equal(Math.round(rows.reduce((s, r) => s + r.pct, 0)), 100);
});

test("parsePlan extracts JSON wrapped in prose or code fences", () => {
  const p = parsePlan("Here you go:\n```json\n" + JSON.stringify(sample) + "\n```");
  assert.equal(p.title, "T");
  assert.deepEqual(p.ideas, []);
});

test("parsePlan rejects incomplete or non-JSON replies", () => {
  assert.throws(() => parsePlan("no json here"));
  assert.throws(() => parsePlan(JSON.stringify({ ...sample, budget: [] })));
});

test("buildPrompt includes the form details and any requested change", () => {
  const p = buildPrompt(form, sample, "cut the budget 15%");
  for (const s of ["wedding", "Delhi", "₹1500000", "cut the budget 15%"]) assert.ok(p.includes(s));
  assert.ok(!buildPrompt(form).includes("Apply this change"));
});

test("fallbackPlan returns a complete plan for every event type", () => {
  for (const type of TYPES) {
    const p = fallbackPlan({ ...form, type });
    assert.equal(p.budget.reduce((s, r) => s + r.percent, 0), 100);
    assert.ok(p.timeline.length > 0 && p.vendors.length > 0 && p.ideas.length > 0);
  }
});
