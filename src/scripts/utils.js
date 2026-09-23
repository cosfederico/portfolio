// Scripts run once per session under ClientRouter, but pages are swapped in
// and out. onPage() runs `init` on every page view that contains `selector`
// and hands it an AbortSignal that fires when that page is swapped out - pass
// it to window/document listeners (and use it to clear timers) so nothing a
// page sets up outlives it.
export function onPage(selector, init) {
  document.addEventListener("astro:page-load", () => {
    const root = document.querySelector(selector);
    if (!root) return;
    const controller = new AbortController();
    document.addEventListener("astro:before-swap", () => controller.abort(), { once: true });
    init(root, controller.signal);
  });
}

export function readEmbeddedJson(id) {
  try {
    return JSON.parse(document.getElementById(id)?.textContent ?? "null");
  } catch {
    return null;
  }
}

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

