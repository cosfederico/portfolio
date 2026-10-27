import { onPage, readEmbeddedJson } from "./utils.js";
import { createPolaroid } from "./polaroid.js";
import { fillParallaxStack } from "./parallax-bg.js";

// Photography page: collection filter (synced to #slug) and the polaroid
// viewer, which steps through a collection and is deep-linkable as #photo-id.
onPage("#collections", (container, signal) => {
  const data = readEmbeddedJson("photos-data") ?? {};
  const nav = document.getElementById("collection-nav");
  const sections = [...container.querySelectorAll(".collection")];
  const filterButtons = [...nav.querySelectorAll(".filter-btn")];
  let filter = "all";

  fillParallaxStack(document.getElementById("photos-bg-stack"), signal);

  // ── Filter ──

  function applyFilter(slug, { scroll = false } = {}) {
    filter = data[slug] ? slug : "all";
    sections.forEach((section) => (section.hidden = filter !== "all" && section.dataset.collection !== filter));
    filterButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.filter === filter)));
    // Reveal-on-scroll never fires for sections that were hidden while
    // scrolling past them, so shown sections are made visible outright.
    sections.forEach((section) => !section.hidden && section.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible")));
    if (scroll && container.getBoundingClientRect().top < 0) container.scrollIntoView({ block: "start" });
  }

  const filterHash = () => (filter === "all" ? location.pathname : `#${filter}`);

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    applyFilter(btn.dataset.filter, { scroll: true });
    history.replaceState(history.state, "", filterHash());
  });

  // ── Polaroid ──

  const modal = document.getElementById("polaroid-modal");
  let current = null; // { slug, index }

  const polaroid = createPolaroid(modal, signal, {
    onClose: () => {
      current = null;
      history.replaceState(history.state, "", filterHash());
    },
  });

  const tileFor = (slug, index) => container.querySelector(`.photo-tile[data-collection="${slug}"][data-index="${index}"]`);

  function open(slug, index) {
    current = { slug, index };
    polaroid.open(data[slug][index], tileFor(slug, index));
    afterShow();
  }

  function step(direction) {
    if (!current || !polaroid.isOpen()) return;
    const photos = data[current.slug];
    current.index = (current.index + direction + photos.length) % photos.length;
    polaroid.show(photos[current.index], tileFor(current.slug, current.index));
    afterShow();
  }

  function afterShow() {
    const photos = data[current.slug];
    // Warm the cache for both neighbours so stepping feels instant.
    for (const offset of [1, -1]) {
      new Image().src = photos[(current.index + offset + photos.length) % photos.length].src;
    }
    history.replaceState(history.state, "", `#${photos[current.index].id}`);
  }

  container.addEventListener("click", (e) => {
    const tile = e.target.closest(".photo-tile");
    if (tile) open(tile.dataset.collection, Number(tile.dataset.index));
  });

  document.getElementById("polaroid-prev").addEventListener("click", () => step(-1));
  document.getElementById("polaroid-next").addEventListener("click", () => step(1));

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    },
    { signal }
  );

  // Horizontal swipe on touch screens.
  const panel = modal.querySelector(".polaroid-panel");
  let swipeStart = null;
  panel.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") swipeStart = { x: e.clientX, y: e.clientY };
  });
  panel.addEventListener("pointerup", (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  panel.addEventListener("pointercancel", () => (swipeStart = null));

  // ── Deep links: #slug filters, #photo-id opens that photo ──

  const hash = decodeURIComponent(location.hash.slice(1));
  if (data[hash]) applyFilter(hash);
  for (const [slug, photos] of Object.entries(data)) {
    const index = photos.findIndex((photo) => photo.id === hash);
    if (index !== -1) {
      open(slug, index);
      break;
    }
  }
});
