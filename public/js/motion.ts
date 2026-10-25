/** One switch for every decorative animation. Starts from the visitor's OS setting and can be toggled (WCAG 2.2.2). */
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = !reducedQuery.matches;

export const motionOn = (): boolean => enabled;

function apply(on: boolean): void {
  enabled = on;
  document.documentElement.dataset.motion = on ? "on" : "off";
}

export function initMotionToggle(button: HTMLElement): void {
  apply(enabled);
  button.setAttribute("aria-pressed", String(!enabled));
  button.addEventListener("click", () => {
    apply(!enabled);
    button.setAttribute("aria-pressed", String(!enabled));
  });
}
