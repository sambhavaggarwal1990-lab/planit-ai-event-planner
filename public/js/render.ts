import { normalizeBudget } from "../planner.ts";
import type { BudgetRow, EventForm, Plan } from "../planner.ts";
import { $, el, svg } from "./dom.ts";
import { PALETTE, donutSegments, easeOutCubic, formatMoney, summaryChips } from "./format.ts";
import { motionOn } from "./motion.ts";
import { checklistKey, createStore } from "./store.ts";

const checks = createStore("planit-checks");
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/** Writes the whole plan into the results section. */
export function renderPlan(plan: Plan, form: EventForm): void {
  $("#results").hidden = false;
  $("#title").textContent = plan.title || "Your plan";
  $("#summary").textContent = plan.summary;
  $("#chips").replaceChildren(...summaryChips(form).map((chip) => el("li", {}, chip)));
  renderBudget(plan, form);
  renderTimeline(plan);
  renderVendors(plan);
  renderIdeas(plan);
  animateIn();
}

function countUp(node: HTMLElement, target: number, currency: string): void {
  if (!motionOn()) {
    node.textContent = formatMoney(currency, target);
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min((now - start) / 900, 1);
    node.textContent = formatMoney(currency, Math.round(target * easeOutCubic(progress)));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function donut(rows: BudgetRow[]): SVGElement {
  const circle = { cx: 21, cy: 21, r: 15.915, fill: "none", "stroke-width": 6 };
  const chart = svg("svg", { viewBox: "0 0 42 42", class: "donut", "aria-hidden": "true" });
  chart.append(svg("circle", { ...circle, stroke: "currentColor", opacity: ".12" }));
  const segments = donutSegments(rows);
  const arcs = segments.map((segment, i) => {
    const arc = svg("circle", { ...circle, stroke: PALETTE[i % PALETTE.length], pathLength: 100, "stroke-dashoffset": -segment.offset, transform: "rotate(-90 21 21)" });
    arc.style.strokeDasharray = "0 100";
    return arc;
  });
  chart.append(...arcs);
  afterPaint(() => arcs.forEach((arc, i) => { arc.style.strokeDasharray = `${segments[i].length} ${100 - segments[i].length}`; }));
  return chart;
}

function budgetRow(row: BudgetRow, index: number, currency: string): HTMLElement {
  const color = PALETTE[index % PALETTE.length];
  const fill = el("i");
  fill.style.background = color;
  afterPaint(() => { fill.style.width = `${row.pct.toFixed(1)}%`; });
  const dot = el("b", { class: "dot", "aria-hidden": "true" });
  dot.style.background = color;
  const item = el("li", { class: "reveal" },
    el("div", { class: "line" }, el("span", {}, dot, row.category), el("strong", {}, formatMoney(currency, row.amount))),
    el("div", { class: "bar", "aria-hidden": "true" }, fill),
    el("small", {}, `${Math.round(row.pct)}%${row.tip ? " · " + row.tip : ""}`));
  item.style.animationDelay = `${index * 70}ms`;
  return item;
}

function renderBudget(plan: Plan, form: EventForm): void {
  const rows = normalizeBudget(plan.budget, form.budget);
  const total = el("strong", {}, formatMoney(form.currency, form.budget));
  countUp(total, form.budget, form.currency);
  const nodes: Node[] = [
    el("div", { class: "chart" }, donut(rows), el("div", { class: "centre" }, el("small", {}, "Total budget"), total)),
    el("ul", { class: "plain" }, ...rows.map((row, i) => budgetRow(row, i, form.currency))),
  ];
  if (plan.tips.length) nodes.push(el("p", { class: "tipbox" }, `💡 Savings tips: ${plan.tips.join(" · ")}`));
  $("#budget-panel").replaceChildren(...nodes);
}

function renderTimeline(plan: Plan): void {
  const phases = plan.timeline.map((phase) =>
    el("li", {}, el("strong", {}, phase.when), el("ul", {}, ...(phase.tasks ?? []).map((task) => el("li", {}, task)))));
  $("#timeline").replaceChildren(el("ol", { class: "plain" }, ...phases));
}

function renderIdeas(plan: Plan): void {
  const ideas = plan.ideas.map((idea) => el("li", {}, el("strong", {}, idea.title), el("p", {}, idea.detail)));
  $("#ideas").replaceChildren(el("ul", { class: "plain" }, ...ideas));
}

function renderVendors(plan: Plan): void {
  const saved = checks.load();
  const groups = plan.vendors.map((vendor) =>
    el("fieldset", {}, el("legend", {}, vendor.category), ...(vendor.items ?? []).map((item) => {
      const key = checklistKey(vendor.category, item);
      const box = el("input", { type: "checkbox" });
      box.checked = Boolean(saved[key]);
      box.addEventListener("change", () => {
        checks.save({ ...checks.load(), [key]: box.checked });
        updateProgress();
      });
      return el("label", { class: "check" }, box, el("span", {}, item));
    })));
  $("#vendors").replaceChildren(
    el("p", { id: "progress-text" }),
    el("progress", { id: "progress", max: "1", value: "0", "aria-labelledby": "progress-text" }),
    ...groups,
  );
  updateProgress();
}

function updateProgress(): void {
  const boxes = [...document.querySelectorAll<HTMLInputElement>("#vendors input")];
  const done = boxes.filter((box) => box.checked).length;
  $<HTMLProgressElement>("#progress").value = boxes.length ? done / boxes.length : 0;
  $("#progress-text").textContent = `${done} of ${boxes.length} items confirmed`;
}

function animateIn(): void {
  document.querySelectorAll<HTMLElement>("#chips li, #timeline ol > li, #ideas ul > li, #vendors fieldset").forEach((node, i) => {
    node.classList.add("reveal");
    node.style.animationDelay = `${(i % 8) * 70}ms`;
  });
}
