import { onPage, readEmbeddedJson } from "./utils.js";

// Photography page: collection filter (synced to #slug) and the lightbox
// (native <dialog>, deep-linkable as #photo-id).
onPage("#collections", (container, signal) => {
  const data = readEmbeddedJson("photos-data") ?? {};
  const nav = document.getElementById("collection-nav");
  const sections = [...container.querySelectorAll(".collection")];
  const filterButtons = [...nav.querySelectorAll(".filter-btn")];
  let filter = "all";

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

  // ── Lightbox ──

  const lightbox = document.getElementById("lightbox");
  const stage = document.getElementById("lightbox-stage");
  const image = document.getElementById("lightbox-image");
  const title = document.getElementById("lightbox-title");
  const counter = document.getElementById("lightbox-counter");
  const date = document.getElementById("lightbox-date");
  const exif = document.getElementById("lightbox-exif");
  let current = null; // { slug, index }

  const photosOf = (slug) => data[slug]?.photos ?? [];

  function open(slug, index) {
    current = { slug, index };
    render();
    document.body.classList.add("modal-open");
    if (!lightbox.open) lightbox.showModal();
  }

  function step(direction) {
    if (!current) return;
    const total = photosOf(current.slug).length;
    current.index = (current.index + direction + total) % total;
    render();
  }

  function render() {
    const photos = photosOf(current.slug);
    const photo = photos[current.index];
    title.textContent = data[current.slug].title;
    counter.textContent = `${current.index + 1} / ${photos.length}`;
    date.textContent = photo.date;
    exif.textContent = photo.exif;

    // Dim the previous photo until the next one has decoded, instead of
    // flashing an empty stage.
    image.classList.add("is-loading");
    image.alt = photo.alt;
    image.width = photo.width;
    image.height = photo.height;
    image.srcset = photo.srcset;
    image.src = photo.src;
    const shown = photo.id;
    image
      .decode()
      .catch(() => {})
      .then(() => photos[current?.index]?.id === shown && image.classList.remove("is-loading"));

    // Warm the cache for both neighbours so stepping feels instant.
    for (const offset of [1, -1]) {
      const next = photos[(current.index + offset + photos.length) % photos.length];
      Object.assign(new Image(), { sizes: image.sizes, srcset: next.srcset, src: next.src });
    }

    history.replaceState(history.state, "", `#${photo.id}`);
  }

  container.addEventListener("click", (e) => {
    const tile = e.target.closest(".photo-tile");
    if (tile) open(tile.dataset.collection, Number(tile.dataset.index));
  });

  document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
  document.getElementById("lightbox-prev").addEventListener("click", () => step(-1));
  document.getElementById("lightbox-next").addEventListener("click", () => step(1));
  lightbox.addEventListener("click", (e) => e.target === lightbox && lightbox.close());
  lightbox.addEventListener("close", () => {
    current = null;
    document.body.classList.remove("modal-open");
    history.replaceState(history.state, "", filterHash());
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (!lightbox.open) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    },
    { signal }
  );

  // Horizontal swipe on touch screens.
  let swipeStart = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") swipeStart = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener("pointerup", (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  stage.addEventListener("pointercancel", () => (swipeStart = null));

  // ── Deep links: #slug filters, #photo-id opens that photo ──

  const hash = decodeURIComponent(location.hash.slice(1));
  if (data[hash]) applyFilter(hash);
  for (const [slug, collection] of Object.entries(data)) {
    const index = collection.photos.findIndex((photo) => photo.id === hash);
    if (index !== -1) {
      open(slug, index);
      break;
    }
  }
});
