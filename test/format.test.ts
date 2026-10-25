import test from "node:test";
import assert from "node:assert/strict";
import { donutSegments, easeOutCubic, formatMoney, summaryChips } from "../public/js/format.ts";
import type { EventForm } from "../public/planner.ts";

const form: EventForm = { type: "wedding", who: "", date: "", guests: 150, budget: 1500000, currency: "₹", city: "Delhi", vibe: "", notes: "" };

test("formatMoney groups rupees the Indian way and other currencies the US way", () => {
  assert.equal(formatMoney("₹", 1500000), "₹15,00,000");
  assert.equal(formatMoney("$", 1500000), "$1,500,000");
});

test("summaryChips lists guests, budget, per-guest cost and the city when given", () => {
  assert.deepEqual(summaryChips(form), ["150 guests", "₹15,00,000 budget", "₹10,000 per guest", "Delhi"]);
  assert.equal(summaryChips({ ...form, city: "" }).length, 3);
});

test("donutSegments places arcs one after another with a small gap", () => {
  const segments = donutSegments([{ pct: 50 }, { pct: 30 }, { pct: 20 }]);
  assert.deepEqual(segments.map((segment) => segment.offset), [0, 50, 80]);
  assert.ok(Math.abs(segments[0].length - 49.4) < 1e-9);
  assert.equal(donutSegments([{ pct: 0.2 }])[0].length, 0);
});

test("easeOutCubic starts at 0, ends at 1 and moves fast at first", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
});
