import { fallbackPlan, validateForm } from "./planner.ts";
import type { Currency, EventForm, EventType, Plan } from "./planner.ts";
import { requestPlan } from "./js/api.ts";
import { $ } from "./js/dom.ts";
import { animateBrand, enableCardTilt, enableMagnet, fireworks, runSplash, startStage } from "./js/effects.ts";
import { initMotionToggle } from "./js/motion.ts";
import { renderPlan } from "./js/render.ts";
import { setupTabs } from "./js/tabs.ts";

const LOADING_STEPS = ["Checking venues and vendors…", "Balancing your budget…", "Drafting the timeline…", "Adding personal touches…"];
const state: { form: EventForm | null; plan: Plan | null; spinner?: ReturnType<typeof setInterval> } = { form: null, plan: null };

const say = (text: string): void => {
  $("#msg").textContent = text;
};

function readForm(): EventForm {
  const value = (id: string) => $<HTMLInputElement>("#" + id).value.trim();
  return {
    type: $<HTMLInputElement>('input[name="type"]:checked').value as EventType,
    who: value("who"),
    date: value("date"),
    guests: Number(value("guests")),
    budget: Number(value("budget")),
    currency: $<HTMLSelectElement>("#currency").value as Currency,
    city: value("city"),
    vibe: value("vibe"),
    notes: value("notes"),
  };
}

/** Shows or hides the loading screen and locks the buttons while a plan is being made. */
function setBusy(on: boolean): void {
  $<HTMLButtonElement>("#go").disabled = $<HTMLButtonElement>("#update").disabled = on;
  $("#go").textContent = on ? "Planning…" : "Create my plan";
  $("#results").setAttribute("aria-busy", String(on));
  $("#loader").hidden = !on;
  clearInterval(state.spinner);
  if (!on) return;
  let step = 0;
  $("#loader-text").textContent = LOADING_STEPS[0];
  state.spinner = setInterval(() => { $("#loader-text").textContent = LOADING_STEPS[++step % LOADING_STEPS.length]; }, 1600);
}

/** AI plan when possible. A first plan falls back to the built-in starter plan; a tweak reports the error instead. */
async function loadPlan(form: EventForm, change?: string): Promise<{ plan: Plan; label: string; notice: string }> {
  try {
    const plan = await requestPlan({ form, plan: state.plan, change });
    return { plan, label: plan.model ? `AI-generated plan · ${plan.model}` : "AI-generated plan", notice: "" };
  } catch (err) {
    if (change) throw err;
    const reason = err instanceof Error ? err.message.replace(/\.$/, "") : "AI is unavailable";
    return { plan: fallbackPlan(form), label: "Starter template", notice: `${reason}. Showing a starter plan instead.` };
  }
}

async function generate(change?: string): Promise<void> {
  if (!change) state.form = readForm();
  const form = state.form;
  if (!form) return;
  const errors = validateForm(form);
  if (errors.length) return say(errors.join(" "));
  setBusy(true);
  say("Planning…");
  try {
    const { plan, label, notice } = await loadPlan(form, change);
    state.plan = plan;
    $("#mode").textContent = label;
    say(notice);
  } catch (err) {
    say(`Couldn’t update the plan: ${err instanceof Error ? err.message : "please try again"}`);
    return setBusy(false);
  }
  renderPlan(state.plan as Plan, form);
  setBusy(false);
  $("#results").focus();
  if (change) $<HTMLInputElement>("#tweak").value = "";
  else fireworks($<HTMLCanvasElement>("#fx"));
}

$("#plan-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void generate();
});
$("#tweak-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const change = $<HTMLInputElement>("#tweak").value.trim();
  if (change) void generate(change);
});

initMotionToggle($("#motion-toggle"));
setupTabs();
animateBrand($("#brand"));
startStage($<HTMLCanvasElement>("#petals"));
enableCardTilt();
enableMagnet($("#go"));
runSplash($("#splash"));
