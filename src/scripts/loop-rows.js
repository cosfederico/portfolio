import { prefersReducedMotion } from "./utils.js";
import { LOOP_BUFFER_CARDS } from "../lib/constants.js";

// Infinite horizontal film-strip rows (.playlist-row, styled in global.css),
// shared by the videos and events pages.
//
// Looped rows were rendered as [clone tail][real cards][clone head]. Clones
// mirror the real cards, so jumping scrollLeft by exactly one real-content
// width is invisible - the same fixed set of nodes scrolls forever.
//
// The jump only happens once scrolling has come to rest: moving scrollLeft
// mid-gesture cancels or stutters the browser's momentum ('throwing' the
// strip). At rest the strip is re-centred, leaving a full clone buffer of
// runway on both sides for the next throw; only a throw that nears the
// physical end of the strip triggers an immediate jump.
export function initLoopRows(signal) {
  const restEvent = "onscrollend" in window; // no scrollend (older Safari): debounce instead

  const rows = [...document.querySelectorAll(".playlist-row")].map((row) => {
    const scroller = row.querySelector(".playlist-row__scroller");
    return {
      scroller,
      arrows: row.querySelector(".playlist-row__arrows"),
      loop: scroller.dataset.loop === "true",
      realCount: Number(scroller.dataset.realCount) || 0,
      cardWidth: 0,
      realWidth: 0,
      restTimer: 0,
    };
  });

  // Measured from the laid-out cards rather than multiplied out, so
  // fractional (rem-based) card widths can't accumulate rounding drift.
  const measure = (row) => {
    const cards = row.scroller.children;
    const x = (i) => cards[i]?.getBoundingClientRect().left ?? 0;
    row.cardWidth = cards[0]?.getBoundingClientRect().width || 0;
    row.realWidth = row.loop ? x(LOOP_BUFFER_CARDS + row.realCount) - x(LOOP_BUFFER_CARDS) : 0;
    row.arrows.hidden = row.scroller.scrollWidth <= row.scroller.clientWidth;
  };

  // Shift by whole real-content widths to the equivalent position closest to
  // the middle of the strip.
  const recenter = (row) => {
    if (!row.realWidth) return;
    const { scroller } = row;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const x = scroller.scrollLeft;
    const shift = Math.round((max / 2 - x) / row.realWidth) * row.realWidth;
    if (shift && x + shift >= 0 && x + shift <= max) scroller.scrollLeft = x + shift;
  };

  for (const row of rows) {
    measure(row);
    if (!row.loop || !row.realWidth) continue;
    const { scroller } = row;
    scroller.scrollLeft = scroller.children[LOOP_BUFFER_CARDS].offsetLeft - scroller.firstElementChild.offsetLeft;
    recenter(row);

    scroller.addEventListener(
      "scroll",
      () => {
        const edge = scroller.clientWidth / 2;
        const max = scroller.scrollWidth - scroller.clientWidth;
        if (scroller.scrollLeft < edge || scroller.scrollLeft > max - edge) recenter(row); // about to hit the end
        if (restEvent) return;
        clearTimeout(row.restTimer);
        row.restTimer = setTimeout(() => recenter(row), 200);
      },
      { passive: true }
    );
    if (restEvent) scroller.addEventListener("scrollend", () => recenter(row));
  }

  // Arrows scroll by a screenful of cards; the rest handler re-centres after.
  for (const row of rows) {
    row.arrows.addEventListener("click", (e) => {
      const direction = Number(e.target.closest("[data-scroll]")?.dataset.scroll);
      if (!direction || !row.cardWidth) return;
      const cards = Math.max(1, Math.floor(row.scroller.clientWidth / row.cardWidth) - 1);
      row.scroller.scrollBy({ left: direction * cards * row.cardWidth, behavior: prefersReducedMotion() ? "instant" : "smooth" });
    });
  }

  let resizeTimer;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const row of rows) {
          const cardIndex = row.cardWidth ? Math.round(row.scroller.scrollLeft / row.cardWidth) : 0;
          measure(row);
          if (row.cardWidth) row.scroller.scrollLeft = cardIndex * row.cardWidth;
          recenter(row);
        }
      }, 200);
    },
    { signal }
  );
  signal.addEventListener("abort", () => {
    clearTimeout(resizeTimer);
    rows.forEach((row) => clearTimeout(row.restTimer));
  });
}
