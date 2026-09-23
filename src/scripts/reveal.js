import { onPage } from "./utils.js";

// Fades .reveal elements in as they scroll into view, staggered by document
// order. The stagger delay is removed once revealed so it doesn't linger on
// the element's own hover transitions.
onPage("body", (_, signal) => {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting) continue;
        target.classList.add("is-visible");
        target.addEventListener("transitionend", () => (target.style.transitionDelay = ""), { once: true });
        observer.unobserve(target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  items.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i, 8) * 0.08}s`;
    observer.observe(el);
  });
  signal.addEventListener("abort", () => observer.disconnect());
});
