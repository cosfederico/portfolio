import { onPage, readEmbeddedJson, prefersReducedMotion } from "./utils.js";
import { formatShortDate } from "../lib/format.js";

// The polaroid choreography's timings live in index.astro's styles as
// --polaroid-* custom properties and are read back here, so the durations CSS
// transitions with and the ones scheduled here can't drift apart. Units must
// be ms or s. Under reduced motion every flight and wait collapses to zero
// (the CSS media query can't reach Web Animations).
function readTiming() {
  const css = getComputedStyle(document.documentElement);
  const reduce = prefersReducedMotion();
  const ms = (name) => {
    const raw = css.getPropertyValue(name).trim();
    const value = parseFloat(raw);
    if (reduce || !Number.isFinite(value)) return 0;
    return raw.endsWith("ms") ? value : value * 1000;
  };
  return {
    flight: ms("--polaroid-flight"),
    frameFade: ms("--polaroid-frame-fade"),
    frameLead: ms("--polaroid-frame-lead"),
    closeLead: ms("--polaroid-close-lead"),
    easing: css.getPropertyValue("--polaroid-ease").trim() || "ease",
  };
}

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

  const T = readTiming();
  const scroller = grid.closest(".home-mosaic");
  const header = document.querySelector(".site-header");
  const images = shuffle(items);
  let focusMode = false;
  let resizeTimer;
  let resumeTimer;

  // Polaroid state. `busy` spans the whole interaction, click through
  // landing: the mosaic must not re-lay tiles under an open or animating
  // polaroid.
  let busy = false;
  let renderPending = false;
  let relayoutPending = false;
  let closing = false;
  let liftedTile = null;
  let requestId = 0;
  let currentIndex = -1; // mosaic position of the photo in the polaroid
  let currentAspect = 0;
  let flight = null; // { ghost, animations } of the flight in progress
  let closeTimer;
  let leadTimer;

  signal.addEventListener("abort", () => {
    [resizeTimer, resumeTimer, closeTimer, leadTimer].forEach(clearTimeout);
    flight?.animations.forEach((animation) => animation.cancel());
  });

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
      if (polaroid.modal.open && currentAspect) sizePolaroid(currentAspect);
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
      if (focusMode) openPolaroid(itemAt(tile._index), tile);
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
  // Open: the photo flies out of its tile into the polaroid's photo slot
  // (a FLIP zoom), and the frame fades in around it as it lands. Close: the
  // reverse. A card that was turned over spins face up on its way home.

  const modal = document.getElementById("polaroid-modal");
  const polaroid = {
    modal,
    panel: modal.querySelector(".polaroid-panel"),
    card: modal.querySelector("#polaroid"),
    cardInner: modal.querySelector(".polaroid__card"),
    photoBox: modal.querySelector(".polaroid__photo"),
    backPhotoBox: modal.querySelector(".polaroid__back-photo"),
    image: modal.querySelector("#polaroid-image"),
    flipBtn: modal.querySelector("#polaroid-flip"),
    fields: ["place", "date", "story", "camera", "shutter", "aperture", "iso"].map((key) => [
      key,
      modal.querySelector(`#polaroid-${key}`),
    ]),
  };
  const p = polaroid;

  p.flipBtn.addEventListener("click", () => setFlipped(!isFlipped()));
  modal.querySelector("#polaroid-close").addEventListener("click", closePolaroid);
  // Backdrop clicks land on the dialog element itself.
  modal.addEventListener("click", (e) => e.target === modal && closePolaroid());
  modal.addEventListener("close", () => document.body.classList.remove("modal-open"));
  // ESC fires "cancel" before closing natively - intercepted so it takes the
  // animated route like every other close.
  modal.addEventListener("cancel", (e) => {
    e.preventDefault();
    closePolaroid();
  });

  function sizePolaroid(aspect) {
    currentAspect = aspect;
    const heightBudget = window.innerHeight * 0.6; // share of screen height the photo may occupy
    const widthCap = window.innerWidth * 0.6;
    const minWidth = Math.min(260, window.innerWidth * 0.7);
    const width = Math.max(Math.min(heightBudget * aspect, widthCap), minWidth);
    p.panel.style.width = `${Math.round(width)}px`;
  }

  function fillPolaroid(item) {
    const shown = (value) => (value && String(value).trim() ? value : "N/A");
    for (const [key, el] of p.fields) {
      el.textContent = shown(key === "date" ? formatShortDate(item.date) : item[key]);
    }
  }

  function openPolaroid(item, tile) {
    // A click can land during a close-out; it supersedes whatever that close
    // was still doing rather than racing it.
    const id = ++requestId;
    const isCurrent = () => id === requestId;
    clearTimeout(closeTimer);
    closing = false;
    setBusy(true);

    currentIndex = tile?._index ?? -1;
    setFlipped(false);
    // Only opening clears is-card-flying - a card flight leaves it set on
    // purpose (see runCardCloseFlight).
    p.panel.classList.remove("is-card-flying");
    p.panel.classList.add("is-photo-hidden", "is-chrome-hidden");
    fillPolaroid(item);

    p.photoBox.style.aspectRatio = String(item.aspect);
    p.backPhotoBox.style.aspectRatio = String(item.aspect);
    sizePolaroid(item.aspect);
    p.image.src = item.src;
    p.image.alt = item.alt || "";

    document.body.classList.add("modal-open");
    if (!modal.open) modal.showModal();

    // Two rAFs, not a synchronous read right after showModal(): forcing
    // layout that early collapses the backdrop's @starting-style frame into
    // its target style, so the blur snaps in instead of transitioning.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!isCurrent()) return;
        const toRect = p.photoBox.getBoundingClientRect();
        const liveTile = tile?.isConnected ? tile : null;
        // The tile empties in the same frame the ghost appears - the photo is
        // never in two places, and the hole is what it flies back into.
        liftTile(liveTile);
        runFlight(liveTile?.querySelector("img") ?? p.image, liveTile?.getBoundingClientRect() ?? toRect, toRect, {
          leadMs: T.flight - T.frameLead,
          onLead: () => isCurrent() && p.panel.classList.remove("is-chrome-hidden"),
          // The ghost is the (small) tile image; keep it up until the full
          // size photo underneath has decoded, so the swap never flashes.
          onLanded: async () => {
            await p.image.decode().catch(() => {});
            if (isCurrent()) p.panel.classList.remove("is-photo-hidden");
          },
        });
      })
    );
  }

  function closePolaroid() {
    if (!modal.open || closing) return;
    closing = true;
    // A turned card spins face up as it goes, shedding its frame on the way;
    // a face-up one sheds the frame first, then the bare photo flies home.
    if (isFlipped()) runCardCloseFlight();
    else runCloseSequence();
  }

  function finishClose(id) {
    if (id !== requestId) return; // re-opened mid-flight
    dropTile();
    closing = false;
    setBusy(false);
  }

  function runCardCloseFlight() {
    const id = requestId;
    // close() before measuring: it releases the scroll lock, so the rects
    // describe the layout the card actually flies through.
    modal.close();

    const cardRect = p.cardInner.getBoundingClientRect();
    const photoRect = p.photoBox.getBoundingClientRect();
    const toRect = landingRect(photoRect);

    p.panel.classList.add("is-card-flying");
    runCardFlight(cardRect, photoRect, toRect, () => {
      if (id !== requestId) return;
      // is-card-flying deliberately stays on: the dialog is still painted for
      // its keep-alive window after close(), and un-hiding the panel here
      // would flash the full-size card. The next open clears it.
      resetFlip();
      finishClose(id);
    });
  }

  function runCloseSequence() {
    const id = requestId;
    p.panel.classList.add("is-chrome-hidden");

    closeTimer = setTimeout(() => {
      // close() before measuring (see runCardCloseFlight); the dialog stays
      // painted through the flight via its display/overlay transition.
      modal.close();
      const fromRect = p.photoBox.getBoundingClientRect();
      const toRect = landingRect(fromRect);
      p.panel.classList.add("is-photo-hidden");
      runFlight(p.image, fromRect, toRect, { onLanded: () => finishClose(id) });
    }, T.frameFade - T.closeLead);
  }

  // FLIP zoom shared by both directions: a clone of an already-decoded <img>
  // is parked at `toRect`, transformed to look like it's at `fromRect`, then
  // animated back to no transform. Cloning a live element paints from the
  // decoded bitmap on frame one, where a fresh <img> can flash blank. The
  // scale is uniform so mismatched aspects start small, not stretched.
  function runFlight(sourceImg, fromRect, toRect, options) {
    const ghost = sourceImg.cloneNode();
    ghost.removeAttribute("id");
    ghost.className = "polaroid-flight-ghost";
    ghost.alt = "";
    ghost.loading = "eager";
    placeAt(ghost, toRect);

    const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    const scale = toRect.width ? fromRect.width / toRect.width : 1;

    beginFlight(
      ghost,
      (timing) => [ghost.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }], timing)],
      options
    );
  }

  // Turning variant for putting a turned card back: the ghost is the whole
  // card, so it can spin in 3D on its way home. The wrapper takes the
  // perspective and FLIP translate/scale, the cloned card the rotation. It's
  // the photo slot, not the card, that must come down on the tile, so the
  // translation targets where that slot ends up once the card is scaled.
  function runCardFlight(cardRect, photoRect, toRect, onLanded) {
    const ghost = document.createElement("div");
    ghost.className = "polaroid-flight-ghost polaroid-flight-ghost--card";
    placeAt(ghost, cardRect);
    // The frame dissolves over the back half of the flight.
    ghost.style.setProperty("--polaroid-frame-fade", `${T.flight / 2}ms`);

    const card = p.cardInner.cloneNode(true);
    card.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    ghost.appendChild(card);

    const scale = photoRect.width ? toRect.width / photoRect.width : 1;
    const cardCx = cardRect.left + cardRect.width / 2;
    const cardCy = cardRect.top + cardRect.height / 2;
    const dx = toRect.left + toRect.width / 2 - cardCx - scale * (photoRect.left + photoRect.width / 2 - cardCx);
    const dy = toRect.top + toRect.height / 2 - cardCy - scale * (photoRect.top + photoRect.height / 2 - cardCy);

    beginFlight(
      ghost,
      (timing) => [
        ghost.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], timing),
        card.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], timing),
      ],
      {
        onLanded,
        // Frame dissolves from the moment the photo side faces out (edge-on)
        // until touchdown, so what settles into the tile is a bare photo.
        leadMs: T.flight / 2,
        onLead: () => ghost.classList.add("is-chrome-hidden"),
      }
    );
  }

  function placeAt(el, rect) {
    Object.assign(el.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  // Parks the ghost, runs its animations as one unit, and drops it whether it
  // lands or is superseded by a newer flight. A superseded flight must NOT
  // report a landing - that let an interrupted open reveal the full-size
  // photo under the close flight that replaced it.
  function beginFlight(ghost, createAnimations, { onLanded, onLead, leadMs } = {}) {
    if (flight) {
      flight.animations.forEach((animation) => animation.cancel());
      flight.ghost.remove();
    }
    clearTimeout(leadTimer);

    ghost.setAttribute("aria-hidden", "true");
    // Inside the dialog: an open <dialog> paints in the top layer, above any
    // z-index on the page.
    modal.appendChild(ghost);

    const animations = createAnimations({ duration: T.flight, easing: T.easing, fill: "forwards" });
    const current = { ghost, animations };
    flight = current;
    if (onLead) leadTimer = setTimeout(onLead, Math.max(leadMs ?? 0, 0));

    const drop = () => {
      ghost.remove();
      if (flight === current) flight = null;
    };
    Promise.all(animations.map((animation) => animation.finished)).then(async () => {
      await onLanded?.();
      drop();
    }, drop);
  }

  // Where a closing photo flies back to: its own tile if still on screen,
  // otherwise a small box of the same shape near the bottom of the mosaic.
  function landingRect(fromRect) {
    const tile = live.get(currentIndex);
    if (tile) return tile.getBoundingClientRect();

    const box = scroller.getBoundingClientRect();
    const width = fromRect.width * 0.12;
    const height = fromRect.height * 0.12;
    const cx = box.left + box.width / 2;
    const cy = Math.min(box.bottom, window.innerHeight);
    return new DOMRect(cx - width / 2, cy - height / 2, width, height);
  }

  function isFlipped() {
    return p.card.classList.contains("is-flipped");
  }

  function setFlipped(flipped) {
    p.card.classList.toggle("is-flipped", flipped);
    p.flipBtn.textContent = flipped ? "Turn back" : "Turn over";
  }

  // Face up with no animation - once a ghost has taken over the visuals, an
  // animated turn would be a stale transition still running at the next open.
  function resetFlip() {
    p.cardInner.style.transition = "none";
    setFlipped(false);
    void p.cardInner.offsetWidth; // commit before the transition comes back
    p.cardInner.style.transition = "";
  }

  // The tile whose photo is out in the polaroid sits empty. Tracked as one
  // element, because it must be restored even when its flight is superseded.
  function liftTile(tile) {
    dropTile();
    if (!tile) return;
    liftedTile = tile;
    tile.classList.add("is-lifted");
  }

  function dropTile() {
    liftedTile?.classList.remove("is-lifted");
    liftedTile = null;
  }

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
