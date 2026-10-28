import { onPage, readEmbeddedJson } from "./utils.js";
import { bindPolaroidStepping, createPolaroid } from "./polaroid.js";
import { fillParallaxStack } from "./parallax-bg.js";
import { initLoopRows } from "./loop-rows.js";

// Events page: one looped photo strip per event, and the polaroid viewer,
// which steps through the event it was opened from.
onPage("#events", (container, signal) => {
  const data = readEmbeddedJson("events-data") ?? {};
  fillParallaxStack(document.getElementById("events-bg-stack"), signal);
  initLoopRows(signal);

  const modal = document.getElementById("polaroid-modal");
  let current = null; // { slug, index }
  const polaroid = createPolaroid(modal, signal, { onClose: () => (current = null) });

  // Stepping flies back to the real tile, not one of the loop's clones.
  const tileFor = (slug, index) => container.querySelector(`.event-photo[data-event="${slug}"][data-index="${index}"]:not([data-clone])`);

  function afterShow() {
    const photos = data[current.slug];
    // Warm the cache for both neighbours so stepping feels instant.
    for (const offset of [1, -1]) {
      new Image().src = photos[(current.index + offset + photos.length) % photos.length].src;
    }
  }

  function step(direction) {
    if (!current || !polaroid.isOpen()) return;
    const photos = data[current.slug];
    current.index = (current.index + direction + photos.length) % photos.length;
    polaroid.show(photos[current.index], tileFor(current.slug, current.index));
    afterShow();
  }

  container.addEventListener("click", (e) => {
    const tile = e.target.closest(".event-photo");
    if (!tile) return;
    current = { slug: tile.dataset.event, index: Number(tile.dataset.index) };
    polaroid.open(data[current.slug][current.index], tile);
    afterShow();
  });

  bindPolaroidStepping(modal, signal, step);
});
