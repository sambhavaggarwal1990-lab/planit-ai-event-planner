import { normalizeBudget, fallbackPlan, validateForm } from "./planner.js";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids); // strings become text nodes, so model output is never parsed as HTML
  return n;
};
const store = {
  load() { try { return JSON.parse(localStorage.getItem("planit-checks")) ?? {}; } catch { return {}; } },
  save(o) { try { localStorage.setItem("planit-checks", JSON.stringify(o)); } catch { /* storage unavailable */ } },
};

let form = null;
let plan = null;

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEPS = ["Checking venues and vendors…", "Balancing your budget…", "Drafting the timeline…", "Adding personal touches…"];
const PALETTE = ["#ff4fa3", "#ffb347", "#ffd93d", "#4fe3c1", "#4fa8ff", "#a78bfa", "#ff6b6b", "#7cf29a", "#f472b6"];
const NS = "http://www.w3.org/2000/svg";
let spin = 0;

const money = (n) => form.currency + Number(n).toLocaleString(form.currency === "₹" ? "en-IN" : "en-US");
const say = (t) => { $("#msg").textContent = t; };
const busy = (on) => {
  $("#go").disabled = $("#update").disabled = on;
  $("#go").textContent = on ? "Planning…" : "Create my plan";
  $("#loader").hidden = !on;
  clearInterval(spin);
  if (on) {
    let i = 0;
    $("#loader-text").textContent = STEPS[0];
    spin = setInterval(() => { $("#loader-text").textContent = STEPS[++i % STEPS.length]; }, 1600);
  }
};

function readForm() {
  const v = (id) => $("#" + id).value.trim();
  return {
    type: document.querySelector('input[name="type"]:checked').value,
    who: v("who"), date: v("date"), guests: Number(v("guests")), budget: Number(v("budget")),
    currency: $("#currency").value, city: v("city"), vibe: v("vibe"), notes: v("notes"),
  };
}

async function requestPlan(change) {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form, plan: change ? plan : undefined, change }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || (data.errors ?? []).join(" ") || "Request failed");
  return data;
}

async function generate(change) {
  if (!change) form = readForm();
  const errors = validateForm(form);
  if (errors.length) return say(errors.join(" "));
  busy(true);
  say("Planning…");
  try {
    plan = await requestPlan(change);
    $("#mode").textContent = plan.model ? `AI-generated plan · ${plan.model}` : "AI-generated plan";
    say("");
  } catch (err) {
    if (change) { say(`Couldn’t update the plan: ${err.message}`); busy(false); return; }
    plan = fallbackPlan(form);
    $("#mode").textContent = "Starter template";
    say(`${err.message.replace(/\.$/, "")}. Showing a starter plan instead.`);
  }
  render();
  animateIn();
  busy(false);
  $("#results").focus();
  if (!change) burst();
  if (change) $("#tweak").value = "";
}

function render() {
  $("#results").hidden = false;
  $("#title").textContent = plan.title || "Your plan";
  $("#summary").textContent = plan.summary;
  const chips = [`${form.guests} guests`, `${money(form.budget)} budget`, `${money(Math.round(form.budget / form.guests))} per guest`];
  if (form.city) chips.push(form.city);
  $("#chips").replaceChildren(...chips.map((c) => el("li", {}, c)));
  renderBudget();
  $("#timeline").replaceChildren(el("ol", { class: "plain" }, ...plan.timeline.map((p) =>
    el("li", {}, el("strong", {}, p.when), el("ul", {}, ...(p.tasks ?? []).map((t) => el("li", {}, t)))))));
  renderVendors();
  $("#ideas").replaceChildren(el("ul", { class: "plain" }, ...plan.ideas.map((i) =>
    el("li", {}, el("strong", {}, i.title), el("p", {}, i.detail)))));
}

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function countUp(node, to) {
  if (reduce) { node.textContent = money(to); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min((t - t0) / 900, 1);
    node.textContent = money(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function donut(rows) {
  const chart = svg("svg", { viewBox: "0 0 42 42", class: "donut", "aria-hidden": "true" });
  chart.append(svg("circle", { cx: 21, cy: 21, r: 15.915, fill: "none", stroke: "currentColor", "stroke-width": 6, opacity: ".12" }));
  let offset = 0;
  const arcs = rows.map((r, i) => {
    const arc = svg("circle", { cx: 21, cy: 21, r: 15.915, fill: "none", stroke: PALETTE[i % PALETTE.length], "stroke-width": 6, pathLength: 100, "stroke-dashoffset": -offset, transform: "rotate(-90 21 21)" });
    arc.style.strokeDasharray = "0 100";
    offset += r.pct;
    return arc;
  });
  chart.append(...arcs);
  requestAnimationFrame(() => requestAnimationFrame(() => arcs.forEach((arc, i) => {
    const len = Math.max(rows[i].pct - 0.6, 0);
    arc.style.strokeDasharray = `${len} ${100 - len}`;
  })));
  return chart;
}

function renderBudget() {
  const rows = normalizeBudget(plan.budget, form.budget);
  const list = rows.map((r, i) => {
    const color = PALETTE[i % PALETTE.length];
    const fill = el("i");
    fill.style.background = color;
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${r.pct.toFixed(1)}%`; }));
    const dot = el("b", { class: "dot", "aria-hidden": "true" });
    dot.style.background = color;
    const li = el("li", { class: "reveal" }, el("div", { class: "line" }, el("span", {}, dot, r.category), el("strong", {}, money(r.amount))),
      el("div", { class: "bar", "aria-hidden": "true" }, fill),
      el("small", {}, `${Math.round(r.pct)}%${r.tip ? " · " + r.tip : ""}`));
    li.style.animationDelay = `${i * 70}ms`;
    return li;
  });
  const total = el("strong", {}, money(form.budget));
  countUp(total, form.budget);
  const nodes = [el("div", { class: "chart" }, donut(rows), el("div", { class: "centre" }, el("small", {}, "Total budget"), total)), el("ul", { class: "plain" }, ...list)];
  if (plan.tips.length) nodes.push(el("p", { class: "tipbox" }, `💡 Savings tips: ${plan.tips.join(" · ")}`));
  $("#budget-panel").replaceChildren(...nodes);
}

function renderVendors() {
  const saved = store.load();
  const groups = plan.vendors.map((v) => el("fieldset", {}, el("legend", {}, v.category), ...(v.items ?? []).map((item) => {
    const key = `${v.category}|${item}`.toLowerCase();
    const box = el("input", { type: "checkbox" });
    box.checked = Boolean(saved[key]);
    box.addEventListener("change", () => { const s = store.load(); s[key] = box.checked; store.save(s); progress(true); });
    return el("label", { class: "check" }, box, el("span", {}, item));
  })));
  $("#vendors").replaceChildren(el("p", { id: "progress-text" }), el("progress", { id: "progress", max: "1", value: "0", "aria-labelledby": "progress-text" }), ...groups);
  progress();
}

function progress(celebrate = false) {
  const boxes = [...document.querySelectorAll("#vendors input")];
  const done = boxes.filter((b) => b.checked).length;
  $("#progress").value = boxes.length ? done / boxes.length : 0;
  $("#progress-text").textContent = `${done} of ${boxes.length} items confirmed`;
  if (celebrate && boxes.length && done === boxes.length) burst();
}

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $("#" + t.getAttribute("aria-controls")).hidden = !on;
  }
  tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); selectTab(tabs[(i + step + tabs.length) % tabs.length]); }
  });
});

$("#plan-form").addEventListener("submit", (e) => { e.preventDefault(); generate(); });
$("#tweak-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const change = $("#tweak").value.trim();
  if (change) generate(change);
});

function animateIn() {
  document.querySelectorAll("#chips li, #timeline ol > li, #ideas ul > li, #vendors fieldset").forEach((n, i) => {
    n.classList.add("reveal");
    n.style.animationDelay = `${(i % 8) * 70}ms`;
  });
}

function burst() {
  if (reduce) return;
  const c = $("#fx");
  const ctx = c.getContext("2d");
  c.width = innerWidth;
  c.height = innerHeight;
  const hues = [330, 28, 48, 190, 270];
  let sparks = [];
  let rockets = [];
  let frame = 0;
  const launch = () => rockets.push({ x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight, vy: -(9 + Math.random() * 4), hue: hues[Math.floor(Math.random() * hues.length)] });
  [0, 300, 600, 900].forEach((ms) => setTimeout(launch, ms));
  (function tick() {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "lighter";
    for (const r of rockets) {
      r.y += r.vy;
      r.vy += 0.12;
      ctx.fillStyle = `hsl(${r.hue} 100% 70%)`;
      ctx.fillRect(r.x, r.y, 3, 8);
      if (r.vy > -1.5) {
        r.done = true;
        for (let i = 0; i < 80; i++) {
          const ang = Math.random() * 6.283;
          const sp = 1 + Math.random() * 5;
          sparks.push({ x: r.x, y: r.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, hue: r.hue + Math.random() * 30 });
        }
      }
    }
    rockets = rockets.filter((r) => !r.done);
    for (const p of sparks) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.98; p.life -= 0.012;
      ctx.fillStyle = `hsl(${p.hue} 100% 65% / ${Math.max(p.life, 0)})`;
      ctx.fillRect(p.x, p.y, 2.5, 2.5);
    }
    sparks = sparks.filter((p) => p.life > 0);
    if (++frame < 260 || sparks.length || rockets.length) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

const splash = $("#splash");
const hideSplash = () => splash.classList.add("done");
splash.addEventListener("click", hideSplash);
setTimeout(hideSplash, reduce ? 0 : 1300);

function stage() {
  if (reduce) return;
  const c = $("#petals");
  const ctx = c.getContext("2d");
  const resize = () => { c.width = innerWidth; c.height = innerHeight; };
  resize();
  addEventListener("resize", resize);
  const dots = Array.from({ length: 70 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
    r: 1 + Math.random() * 2, h: Math.random() < 0.5 ? 320 : 45,
  }));
  const m = { x: -999, y: -999 };
  const root = document.documentElement.style;
  addEventListener("pointermove", (e) => {
    m.x = e.clientX; m.y = e.clientY;
    root.setProperty("--mx", `${e.clientX}px`);
    root.setProperty("--my", `${e.clientY}px`);
  });
  (function loop() {
    if (!document.hidden) {
      ctx.clearRect(0, 0, c.width, c.height);
      dots.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > c.width) p.vx *= -1;
        if (p.y < 0 || p.y > c.height) p.vy *= -1;
        if (Math.hypot(p.x - m.x, p.y - m.y) < 160) { p.x += (m.x - p.x) * 0.012; p.y += (m.y - p.y) * 0.012; }
        ctx.fillStyle = `hsl(${p.h} 100% 75% / 0.9)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
        for (let j = i + 1; j < dots.length; j++) {
          const q = dots[j];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < 120) {
            ctx.strokeStyle = `hsl(${p.h} 100% 75% / ${0.18 * (1 - d / 120)})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      });
    }
    requestAnimationFrame(loop);
  })();
}
stage();

const brand = $("#brand");
brand.setAttribute("aria-label", brand.textContent);
brand.replaceChildren(...[...brand.textContent].map((ch, i) => {
  const s = el("span", { "aria-hidden": "true", class: "ch" }, ch);
  s.style.animationDelay = `${0.25 + i * 0.07}s`;
  return s;
}));

const CARDS = ".types label, #ideas li, .chart";
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest?.(CARDS);
  if (!card || reduce) return;
  const b = card.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width;
  const y = (e.clientY - b.top) / b.height;
  card.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
  card.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
  card.style.setProperty("--cx", `${x * 100}%`);
  card.style.setProperty("--cy", `${y * 100}%`);
});
document.addEventListener("pointerout", (e) => {
  const card = e.target.closest?.(CARDS);
  if (card) { card.style.removeProperty("--rx"); card.style.removeProperty("--ry"); }
});

const go = $("#go");
go.addEventListener("pointermove", (e) => {
  if (reduce) return;
  const b = go.getBoundingClientRect();
  go.style.setProperty("--tx", `${(e.clientX - b.left - b.width / 2) * 0.08}px`);
  go.style.setProperty("--ty", `${(e.clientY - b.top - b.height / 2) * 0.3}px`);
});
go.addEventListener("pointerleave", () => { go.style.removeProperty("--tx"); go.style.removeProperty("--ty"); });
