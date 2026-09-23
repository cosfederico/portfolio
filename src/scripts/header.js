import { onPage } from "./utils.js";

onPage(".site-header", (header, signal) => {
  const toggle = header.querySelector(".nav-toggle");
  const nav = header.querySelector(".site-nav");

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true, signal });

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  nav.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    },
    { signal }
  );
});
