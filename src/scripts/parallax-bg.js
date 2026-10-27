import { prefersReducedMotion } from "./utils.js";

// Repeats a .parallax-bg stack's items in order until the stack covers the
// area it has to fill. With parallax (see .parallax-bg in global.css) that's
// one screen plus the distance the stack travels; otherwise the background
// scrolls with the page and must be as tall as the content. `onAdd` and
// `onRemove` see each clone as it joins or leaves the stack.
export function fillParallaxStack(stack, signal, { onAdd, onRemove } = {}) {
  const originals = [...stack.children];
  const parallax = CSS.supports("animation-timeline: scroll()") && !prefersReducedMotion();

  const fill = () => {
    let height = stack.parentElement.clientHeight;
    if (parallax) {
      const speed = parseFloat(getComputedStyle(stack).getPropertyValue("--parallax-speed")) || 0;
      const distance = Math.max(0, document.documentElement.scrollHeight - innerHeight) * speed;
      stack.style.setProperty("--parallax-distance", `${distance}px`);
      height = innerHeight + distance;
    }

    // Measured, not assumed: the items' aspect ratio is breakpoint-dependent (CSS).
    const itemHeight = originals[0]?.offsetHeight;
    if (!itemHeight) return;
    const count = Math.max(originals.length, Math.ceil(height / itemHeight) || 0);
    while (stack.children.length < count) {
      const clone = originals[stack.children.length % originals.length].cloneNode();
      stack.appendChild(clone);
      onAdd?.(clone);
    }
    while (stack.children.length > count) {
      const extra = stack.lastElementChild;
      onRemove?.(extra);
      extra.remove();
    }
  };

  // Content height and window size both change the fill; body resizes cover both.
  let fillFrame = 0;
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(fillFrame);
    fillFrame = requestAnimationFrame(fill);
  });
  resizeObserver.observe(document.body);
  fill();

  signal.addEventListener("abort", () => {
    resizeObserver.disconnect();
    cancelAnimationFrame(fillFrame);
  });
}
