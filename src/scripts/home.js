import { onPage, readEmbeddedJson } from "./utils.js";
import { formatShortDate } from "../lib/format.js";
import { createPolaroid } from "./polaroid.js";

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

onPage("#home-mosaic-grid", (grid, signal) => {
  const items = readEmbeddedJson("mosaic-data");
  if (!items?.length) return;

  const scroller = grid.closest(".home-mosaic");
  const header = document.querySelector(".site-header");
  const images = shuffle(items);
  let focusMode = false;
  let resizeTimer;
  let resumeTimer;

  // Set by the polaroid for the whole interaction, click through landing: the
  // mosaic must not re-lay tiles under an open or animating polaroid.
  let busy = false;
  let renderPending = false;
  let relayoutPending = false;

  signal.addEventListener("abort", () => [resizeTimer, resumeTimer].forEach(clearTimeout));

  // ── Mosaic ──
  // An endless wall of photos in its own scroll container (scrollbar hidden),
  // so the page itself never grows. Rows are laid out deterministically from
  // one shuffled sequence - position N is always photo N % count - so any row
  // can be rebuilt on demand: only rows near the viewport exist in the DOM,
  // scrolling back up rebuilds exactly what was there, and row 0 is the
  // ceiling. Scrollable space grows a few screens ahead of the viewport.

  const BUFFER_ROWS = 2; // rendered above and below the viewport
  const LOOKAHEAD_SCREENS = 3;
  const live = new Map(); // mosaic position -> tile currently on screen
  const spare = []; // hidden tiles waiting to be reused
  let rows = []; // [{ end, tiles: [{ index, left, width }] }]
  let tileHeight = 0;
  let space = 0; // current scrollable height
  let frameQueued = false;

  const itemAt = (index) => images[index % images.length];

  function measure() {
    // --tile-height is a registered <length>, so this reads back in px.
    tileHeight = Math.round(parseFloat(getComputedStyle(grid).getPropertyValue("--tile-height"))) || 200;
    rows = [];
  }

  // Each row is filled until it covers the viewport width; the last tile
  // runs past the edge and is clipped, so ragged row ends never show.
  function ensureRows(count) {
    const width = scroller.clientWidth;
    while (rows.length < count) {
      let index = rows.at(-1)?.end ?? 0;
      const tiles = [];
      for (let left = 0; left < width; index++) {
        const tileWidth = Math.round(tileHeight * itemAt(index).aspect);
        tiles.push({ index, left, width: tileWidth });
        left += tileWidth;
      }
      rows.push({ end: index, tiles });
    }
  }

  function render() {
    frameQueued = false;
    if (busy) {
      renderPending = true;
      return;
    }

    const top = scroller.scrollTop;
    const viewport = scroller.clientHeight;
    const first = Math.max(0, Math.floor(top / tileHeight) - BUFFER_ROWS);
    const last = Math.ceil((top + viewport) / tileHeight) + BUFFER_ROWS;
    ensureRows(last + 1);

    const needed = Math.ceil(top + viewport * (1 + LOOKAHEAD_SCREENS));
    if (needed > space) {
      space = needed;
      grid.style.height = `${space}px`;
    }

    const wanted = new Set();
    for (let r = first; r <= last; r++) {
      for (const { index, left, width } of rows[r].tiles) {
        wanted.add(index);
        if (live.has(index)) continue;
        const tile = spare.pop() ?? createTile();
        assignTile(tile, index);
        Object.assign(tile.style, { left: `${left}px`, top: `${r * tileHeight}px`, width: `${width}px`, height: `${tileHeight}px` });
        tile.hidden = false;
        if (!tile.isConnected) grid.appendChild(tile);
        live.set(index, tile);
      }
    }
    for (const [index, tile] of live) {
      if (wanted.has(index)) continue;
      live.delete(index);
      tile.hidden = true;
      tile.classList.remove("is-focused");
      spare.push(tile);
    }
  }

  // Width or tile size changed: rebuild the rows, keeping the photo that was
  // at the top of the screen at the top.
  function relayout() {
    if (busy) {
      relayoutPending = true;
      return;
    }
    const anchor = rows[Math.floor(scroller.scrollTop / tileHeight)]?.tiles[0]?.index ?? 0;
    measure();
    for (const tile of live.values()) {
      tile.hidden = true;
      spare.push(tile);
    }
    live.clear();

    let row = 0;
    ensureRows(1);
    while (rows[row].end <= anchor) ensureRows(++row + 1);
    space = row * tileHeight + scroller.clientHeight * (1 + LOOKAHEAD_SCREENS);
    grid.style.height = `${space}px`;
    scroller.scrollTop = row * tileHeight;
    render();
  }

  scroller.addEventListener(
    "scroll",
    () => {
      header?.classList.toggle("is-scrolled", scroller.scrollTop > 40);
      if (frameQueued) return;
      frameQueued = true;
      requestAnimationFrame(render);
    },
    { passive: true }
  );

  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 250);
    },
    { signal }
  );

  function createTile() {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "mosaic-tile";

    const img = document.createElement("img");
    img.decoding = "async";
    img.alt = "";
    tile.appendChild(img);

    tile.addEventListener("mouseenter", () => {
      // Not while the polaroid owns the screen: the dialog unmounting under a
      // stationary cursor counts as entering the tile beneath it.
      if (!focusMode || busy) return;
      grid.classList.add("is-hovering");
      tile.classList.add("is-focused");
    });
    tile.addEventListener("mouseleave", () => {
      grid.classList.remove("is-hovering");
      tile.classList.remove("is-focused");
    });
    tile.addEventListener("click", () => {
      if (focusMode) polaroid.open(itemAt(tile._index), tile);
    });
    return tile;
  }

  function assignTile(tile, index) {
    const item = itemAt(index);
    tile._index = index;
    tile.setAttribute("aria-label", item.date ? `View photo from ${formatShortDate(item.date)}` : "View photo details");
    const img = tile.firstElementChild;
    if (img.getAttribute("src") !== item.thumb) img.src = item.thumb; // only touch the network when it changes
  }

  measure();
  render();

  // ── Interactive mode ──
  // Off: the mosaic is decoration - inert (it still scrolls) and hidden from
  // assistive tech. On: tiles become real, focusable buttons.

  const toggle = document.getElementById("focus-switch");
  const setFocusMode = (on) => {
    focusMode = on;
    toggle.classList.toggle("is-on", on);
    toggle.setAttribute("aria-checked", String(on));
    document.body.classList.toggle("focus-mode-on", on);
    grid.classList.toggle("focus-enabled", on);
    grid.inert = !on;
    if (on) scroller.removeAttribute("aria-hidden");
    else scroller.setAttribute("aria-hidden", "true");
    if (!on) grid.classList.remove("is-hovering");
  };
  setFocusMode(false);
  toggle.addEventListener("click", () => setFocusMode(!focusMode));

  // ── Polaroid ──

  const polaroid = createPolaroid(document.getElementById("polaroid-modal"), signal, { onBusy: setBusy });

  function setBusy(value) {
    busy = value;
    clearTimeout(resumeTimer);
    if (busy) {
      grid.classList.remove("is-hovering");
      return;
    }
    if (!renderPending && !relayoutPending) return;
    // Deferred, so the re-layout doesn't land on the photo that just flew home.
    resumeTimer = setTimeout(() => {
      const relayoutNeeded = relayoutPending;
      renderPending = relayoutPending = false;
      relayoutNeeded ? relayout() : render();
    }, 350);
  }
});
