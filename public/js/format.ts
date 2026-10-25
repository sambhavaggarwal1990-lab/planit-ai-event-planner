/** Pure presentation helpers (no DOM), so they can be unit tested. */
import type { EventForm } from "../planner.ts";

export const PALETTE = ["#ff4fa3", "#ffb347", "#ffd93d", "#4fe3c1", "#4fa8ff", "#a78bfa", "#ff6b6b", "#7cf29a", "#f472b6"];

export const formatMoney = (currency: string, amount: number): string =>
  currency + Number(amount).toLocaleString(currency === "₹" ? "en-IN" : "en-US");

export function summaryChips(form: EventForm): string[] {
  const chips = [
    `${form.guests} guests`,
    `${formatMoney(form.currency, form.budget)} budget`,
    `${formatMoney(form.currency, Math.round(form.budget / form.guests))} per guest`,
  ];
  if (form.city) chips.push(form.city);
  return chips;
}

export type DonutSegment = { offset: number; length: number };

/** Arc start and length (in percent of a full circle) for each budget row, with a small gap between arcs. */
export function donutSegments(rows: readonly { pct: number }[], gap = 0.6): DonutSegment[] {
  let offset = 0;
  return rows.map((row) => {
    const segment = { offset, length: Math.max(row.pct - gap, 0) };
    offset += row.pct;
    return segment;
  });
}

export const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;
