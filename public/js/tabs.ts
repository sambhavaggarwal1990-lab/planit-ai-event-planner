import { $ } from "./dom.ts";

/** Accessible tabs: click, Left/Right arrows and Home/End, with a roving tabindex. */
export function setupTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];

  function select(tab: HTMLElement): void {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
      $("#" + t.getAttribute("aria-controls")).hidden = !active;
    }
    tab.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const target = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (target === undefined) return;
      e.preventDefault();
      select(tabs[(target + tabs.length) % tabs.length]);
    });
  });
}
