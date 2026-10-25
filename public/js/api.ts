import type { EventForm, Plan } from "../planner.ts";

export type PlanRequest = { form: EventForm; plan?: Plan | null; change?: string };
type ErrorReply = { error?: string; errors?: string[] };

/** Asks the server for a plan, or for a revised plan when `change` is given. Throws an Error with a readable message. */
export async function requestPlan({ form, plan, change }: PlanRequest, fetchImpl: typeof fetch = fetch): Promise<Plan> {
  const res = await fetchImpl("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form, plan: change ? plan : undefined, change }),
  });
  const data = (await res.json().catch(() => ({}))) as Plan & ErrorReply;
  if (!res.ok) throw new Error(data.error || (data.errors ?? []).join(" ") || `Request failed (${res.status})`);
  return data;
}
