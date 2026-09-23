import { LOOP_BUFFER_CARDS } from "../lib/constants.js";

// Everything that used to be fetched at runtime (photos.json, videos.json,
// mosaic-items.json, youtube-playlists.json, background-videos.json) is now
// either rendered directly into the page HTML by Astro, or - where client
// JS genuinely needs the raw dataset (the mosaic's recycling pool, the
// photo lightbox's prev/next navigation) - embedded as an inline
// <script type="application/json"> data island by the relevant .astro
// page. Either way, there's no more fetch() waterfall on page load.

// Timings for the polaroid's open/close choreography. The photo itself
// "flies" - a FLIP zoom between its mosaic tile and the polaroid's photo
// slot - while the frame fades the opposite way, the two deliberately
// overlapping so they read as a single motion rather than two steps.
//
// The numbers live in global.css as the --polaroid-* custom properties and
// are read back from there, so the durations CSS transitions with and the
// ones scheduled here are the same values by construction instead of by
// remembering to edit both. Tune the animation in the stylesheet.
let polaroidTiming = null;

const POLAROID = () =>
  (polaroidTiming ??= (() => {
    const css = getComputedStyle(document.documentElement);
    const ms = (name) => {
      const raw = css.getPropertyValue(name).trim();
      const value = parseFloat(raw);
      if (!Number.isFinite(value)) return 0; // property missing: degrade to no animation rather than NaN
      return raw.endsWith("ms") ? value : value * 1000;
    };
    return {
      flight: ms("--polaroid-flight"),
      frameFade: ms("--polaroid-frame-fade"),
      frameLead: ms("--polaroid-frame-lead"),
      closeLead: ms("--polaroid-close-lead"),
      easing: css.getPropertyValue("--polaroid-ease").trim() || "ease",
    };
  })());

const Site = {
  focusMode: false,
  _aspectCache: new Map(),

  // With View Transitions (see Layout.astro), this whole module only ever
  // executes ONCE per browsing session - Astro recognizes the same script
  // across pages and doesn't re-run it, and it swaps the page content
  // in-place rather than doing a full reload. `astro:page-load` is Astro's
  // event for "the page content is ready" that fires both on that one
  // initial load AND after every subsequent transition, so init() runs
  // once per page view the way it always did - it just can't assume it's
  // starting from a blank slate: some setup (window-level listeners) must
  // only ever happen once, other setup (wiring up this page's now-fresh
  // DOM nodes) must happen every time. See the comments below on each
  // function for which case it is.
  init() {
    this.initHeaderScrollOnce();
    this.initMobileNav();
    this.initReveal();
    this.initContactForm();
    this.initPage();
  },

  readEmbeddedJson(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return null;
    }
  },

  initMobileNav() {
    const toggle = document.querySelector(".nav-toggle");
    const nav = document.querySelector(".site-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isOpen));
      nav.classList.toggle("is-open", !isOpen);
      document.body.classList.toggle("modal-open", !isOpen);
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
        document.body.classList.remove("modal-open");
      });
    });
  },

  // The header itself is ordinary page content re-rendered fresh on every
  // navigation (not persisted across the view transition), so the actual
  // element needs re-reading on every page-load - but the window scroll
  // listener must only ever be attached ONCE, or it piles up one instance
  // per navigation for the rest of the session. Solved by binding the
  // listener a single time and having it look up the current header itself
  // each time it fires, rather than closing over a specific (page-load) copy.
  initHeaderScrollOnce() {
    const onScroll = () => {
      document.querySelector(".site-header")?.classList.toggle("is-scrolled", window.scrollY > 40);
    };
    onScroll();

    if (this._headerScrollBound) return;
    this._headerScrollBound = true;
    window.addEventListener("scroll", onScroll, { passive: true });
  },

  initReveal() {
    // A fresh page-load always means fresh (unobserved) .reveal elements -
    // the old observer's targets are gone with the old DOM, so it's just
    // disconnected rather than left to reference dead nodes indefinitely.
    this._revealObserver?.disconnect();

    const items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    items.forEach((el, i) => {
      el.style.transitionDelay = `${i * 0.08}s`;
      observer.observe(el);
    });

    this._revealObserver = observer;
  },

  initPage() {
    const page = document.body.dataset.page;
    switch (page) {
      case "home":
        this.initMosaic();
        this.initFocusToggle();
        break;
      case "photos":
        this.initPhotosPage();
        break;
      case "videos":
        this.initVideosPage();
        break;
      default:
        break;
    }
  },

  // Infinite-scroll mosaic: renders a bounded pool of tile elements (a few
  // screens' worth) once, then recycles those same DOM/img nodes forever as
  // the user scrolls - looping back through the image list - instead of
  // growing the DOM without limit or re-fetching/re-decoding images that are
  // already loaded.
  //
  // Guards on the actual grid element, not a boolean "have I ever run"
  // flag: with View Transitions, navigating home -> elsewhere -> home again
  // fires this again, and the *page* is fresh (a brand new #home-mosaic-grid
  // element) even though `this` (the one long-lived script instance) isn't.
  // A boolean flag would wrongly skip rebuilding the pool against a grid
  // element that no longer exists, leaving the mosaic permanently empty on
  // revisit. Comparing elements lets a genuinely fresh grid rebuild while
  // still skipping redundant re-init within the same page view.
  initMosaic() {
    const grid = document.getElementById("home-mosaic-grid");
    const items = this.readEmbeddedJson("mosaic-data");
    if (!grid || !items?.length || grid === this._mosaicGrid) return;

    // Tear down the previous visit's pool-growth machinery (its targets -
    // the old grid/sentinel - are gone with the old page) before rebuilding.
    this._mosaicObserver?.disconnect();
    clearTimeout(this._mosaicResizeTimer);
    clearTimeout(this._mosaicResumeTimer);
    // A fresh page view means no polaroid is open, whatever a navigation
    // mid-animation left behind - and a stuck busy flag would make the
    // growth below defer forever, i.e. an empty mosaic.
    this._polaroidBusy = false;
    this._mosaicGrowPending = false;
    this._liftedTile = null; // whatever it pointed at went with the old page

    this._mosaicGrid = grid;
    this._mosaicImages = [...items].sort(() => Math.random() - 0.5);
    this._mosaicCycleIndex = 0;
    this._mosaicPool = [];

    this._mosaicSentinel = document.createElement("div");
    this._mosaicSentinel.className = "mosaic-sentinel";
    this._mosaicSentinel.setAttribute("aria-hidden", "true");
    grid.appendChild(this._mosaicSentinel);

    this._mosaicObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.growOrRecycleMosaic();
      },
      { rootMargin: "800px 0px" } // start loading the next stretch before it's actually visible
    );
    this._mosaicObserver.observe(this._mosaicSentinel);

    this.growOrRecycleMosaic();

    // One-time (not per-visit) window listener; it always reads the
    // *current* this._mosaicGrid/_mosaicSentinel, so it stays correct
    // across however many times the mosaic itself gets rebuilt above.
    if (!this._mosaicResizeBound) {
      this._mosaicResizeBound = true;
      window.addEventListener("resize", () => {
        clearTimeout(this._mosaicResizeTimer);
        this._mosaicResizeTimer = setTimeout(() => this.growOrRecycleMosaic(), 250);
      });
    }
  },

  mosaicTilesPerScreen() {
    const tileHeight = parseInt(getComputedStyle(this._mosaicGrid).getPropertyValue("--tile-height"), 10) || 220;
    const estimatedAspect = 1.4; // average landscape/portrait guess, used only to size the buffer
    const areaPerTile = tileHeight * (tileHeight * estimatedAspect);
    const screenArea = window.innerWidth * window.innerHeight * 1.15; // slight overfill so wrapping leaves no gaps
    return Math.max(6, Math.ceil(screenArea / areaPerTile));
  },

  nextMosaicItem() {
    const item = this._mosaicImages[this._mosaicCycleIndex % this._mosaicImages.length];
    this._mosaicCycleIndex++;
    return item;
  },

  growOrRecycleMosaic() {
    // Recycling moves tiles in the DOM, and in a wrapped flex grid that
    // reflows every row after them. While the polaroid is open or animating
    // that's either invisible work behind the backdrop or, worse, it yanks
    // the tile the photo is flying back to out from under it. Every trigger
    // (sentinel observer, resize, initial fill) routes through here, so this
    // is the one place that needs to know. setPolaroidBusy(false) picks the
    // deferred work back up.
    if (this._polaroidBusy) {
      this._mosaicGrowPending = true;
      return;
    }

    const perScreen = this.mosaicTilesPerScreen();
    const maxPool = perScreen * 3; // hard cap: at most ~3 screens' worth of tiles ever exist at once

    if (this._mosaicPool.length < maxPool) {
      // Still filling the initial buffer - create real tiles (one-time cost).
      const batch = Math.min(perScreen, maxPool - this._mosaicPool.length);
      for (let i = 0; i < batch; i++) {
        const tile = this.createMosaicTile(this.nextMosaicItem());
        this._mosaicGrid.insertBefore(tile, this._mosaicSentinel);
        this._mosaicPool.push(tile);
      }
    } else {
      // Pool is full: recycle the tiles that scrolled furthest above the
      // viewport instead of creating anything new.
      for (let i = 0; i < perScreen; i++) {
        const tile = this._mosaicPool.shift();
        this.assignMosaicTile(tile, this.nextMosaicItem());
        this._mosaicGrid.insertBefore(tile, this._mosaicSentinel); // moves the existing node to the bottom
        this._mosaicPool.push(tile);
      }
    }
  },

  createMosaicTile(item) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "mosaic-tile";
    tile.setAttribute("aria-label", "View photo details");

    const img = document.createElement("img");
    img.decoding = "async";
    img.loading = "lazy";
    tile.appendChild(img);

    tile.addEventListener("mouseenter", () => {
      // Not while the polaroid owns the screen: the dialog unmounting under
      // a stationary cursor counts as entering whatever tile is beneath it,
      // which dimmed the whole mosaic for a moment mid close-animation.
      if (!this.focusMode || this._polaroidBusy) return;
      this._mosaicGrid.classList.add("is-hovering");
      tile.classList.add("is-focused");
    });
    tile.addEventListener("mouseleave", () => {
      this._mosaicGrid.classList.remove("is-hovering");
      tile.classList.remove("is-focused");
    });
    tile.addEventListener("click", () => {
      if (!this.focusMode) return;
      if (tile._item) this.openPolaroid(tile._item, tile);
    });

    this.assignMosaicTile(tile, item);
    return tile;
  },

  assignMosaicTile(tile, item) {
    tile._item = item;
    const img = tile.querySelector("img");
    if (tile._currentSrc !== item.src) {
      img.src = item.src; // only touch the network/decoder when the image is actually changing
      tile._currentSrc = item.src;
    }
    img.alt = item.alt || "";
  },

  initFocusToggle() {
    const toggle = document.getElementById("focus-switch");
    const grid = document.getElementById("home-mosaic-grid");
    if (!toggle) return;

    // Reset (not carried over from a previous visit) - the fresh toggle
    // button always starts unchecked, so internal state should match.
    this.focusMode = false;

    toggle.addEventListener("click", () => {
      this.focusMode = !this.focusMode;
      toggle.classList.toggle("is-on", this.focusMode);
      toggle.setAttribute("aria-checked", String(this.focusMode));
      document.body.classList.toggle("focus-mode-on", this.focusMode);
      if (grid) grid.classList.toggle("focus-enabled", this.focusMode);
      if (!this.focusMode) grid?.classList.remove("is-hovering");
    });
  },

  // The dialog's full markup is static (rendered by index.astro, not built
  // here) - a native <dialog> gives real focus-trapping and ESC-to-close
  // for free, neither of which the old hand-rolled div version had. This
  // only wires up interactivity on top of what's already there.
  //
  // Guards on the actual dialog element (this._polaroidBoundEl), not a
  // boolean flag: openPolaroid() calls this on every click, so *within* one
  // page view it must skip re-wiring an already-wired dialog - but after a
  // View Transitions navigation home -> elsewhere -> home, the dialog is a
  // brand new element (the old one, and its listeners, are gone with the
  // old page), and a boolean flag would wrongly skip rewiring it.
  initPolaroid() {
    const modal = document.getElementById("polaroid-modal");
    if (!modal || modal === this._polaroidBoundEl) return;
    this._polaroidBoundEl = modal;

    // Fresh dialog element, so nothing can still be closing - and a stuck
    // flag here would make closePolaroid() refuse to ever run again.
    this._polaroidClosing = false;
    clearTimeout(this._polaroidCloseTimer);
    clearTimeout(this._polaroidLeadTimer);

    this._polaroid = {
      modal,
      panel: modal.querySelector(".polaroid-panel"),
      card: modal.querySelector("#polaroid"),
      photoBox: modal.querySelector(".polaroid__photo"),
      backPhotoBox: modal.querySelector(".polaroid__back-photo"),
      image: modal.querySelector("#polaroid-image"),
      place: modal.querySelector("#polaroid-place"),
      date: modal.querySelector("#polaroid-date"),
      story: modal.querySelector("#polaroid-story"),
      camera: modal.querySelector("#polaroid-camera"),
      shutter: modal.querySelector("#polaroid-shutter"),
      aperture: modal.querySelector("#polaroid-aperture"),
      iso: modal.querySelector("#polaroid-iso"),
      flipBtn: modal.querySelector("#polaroid-flip"),
    };

    this._polaroid.flipBtn.addEventListener("click", () => {
      this.setPolaroidFlipped(!this.isPolaroidFlipped());
    });

    modal.querySelector("#polaroid-close").addEventListener("click", () => this.closePolaroid());
    // Clicking the backdrop lands on the dialog element itself (not
    // anything inside .polaroid-panel), same trick as the old div version.
    modal.addEventListener("click", (e) => {
      if (e.target === modal) this.closePolaroid();
    });
    // One `close` handler covers every way the dialog can close (button,
    // backdrop click, or the browser's own native ESC handling) instead of
    // duplicating this cleanup at each call site.
    modal.addEventListener("close", () => {
      document.body.classList.remove("modal-open");
    });
    // ESC fires "cancel" (then "close") - without this it'd skip straight to
    // native instant close, bypassing the fly-back-to-mosaic animation.
    modal.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.closePolaroid();
    });

    this.initPolaroidResizeOnce();
  },

  // One-time (not per-dialog-instance) resize listener - it always reads
  // this._polaroid fresh, so it keeps working across however many times
  // initPolaroid() above rebuilds that state.
  initPolaroidResizeOnce() {
    if (this._polaroidResizeBound) return;
    this._polaroidResizeBound = true;
    window.addEventListener("resize", () => {
      const p = this._polaroid;
      if (p?.modal.open && p.currentAspect) this.sizePolaroid(p.currentAspect);
    });
  },

  sizePolaroid(aspect) {
    const p = this._polaroid;
    p.currentAspect = aspect;

    const heightBudget = window.innerHeight * 0.6; // % of screen height the photo may occupy
    const widthCap = window.innerWidth * 0.6; // % of screen width the polaroid may occupy
    const minWidth = Math.min(260, window.innerWidth * 0.7);

    let width = heightBudget * aspect;
    width = Math.min(width, widthCap);
    width = Math.max(width, minWidth);

    p.panel.style.width = `${Math.round(width)}px`;
  },

  formatDateDisplay(dateStr) {
    if (!dateStr) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
    if (!match) return dateStr;
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  },

  // Open: the photo flies out of its mosaic tile into the polaroid's photo
  // slot, and the frame fades in around it as that zoom finishes. Until the
  // flight lands, the panel shows nothing at all (no mat, no shadow, no
  // black photo box) - the ghost is the only polaroid thing on screen, so
  // nothing sits waiting at the destination while the photo is still on its
  // way there.
  async openPolaroid(item, tile) {
    this.initPolaroid();
    const p = this._polaroid;

    // A click can land during a close-out (the dialog is already
    // non-interactive by then, see global.css), so this supersedes whatever
    // that close was still doing rather than racing it.
    const requestId = (this._polaroidRequestId = (this._polaroidRequestId || 0) + 1);
    const isCurrent = () => requestId === this._polaroidRequestId;
    clearTimeout(this._polaroidCloseTimer);
    this._polaroidClosing = false;
    this.setPolaroidBusy(true);

    p.currentItem = item;
    this.setPolaroidFlipped(false);
    // Opening is the only thing that clears is-card-flying - a card flight
    // leaves it set on purpose (see runCardCloseFlight), and a cancelled one
    // never reports a landing at all. Either way a panel left hidden would
    // open onto nothing.
    p.panel.classList.remove("is-card-flying");
    p.panel.classList.add("is-photo-hidden", "is-chrome-hidden");
    this.fillPolaroid(item);

    const aspect = await this.resolveAspect(item, tile);
    if (!isCurrent()) return;

    p.photoBox.style.aspectRatio = String(aspect);
    p.backPhotoBox.style.aspectRatio = String(aspect);
    this.sizePolaroid(aspect);
    p.image.src = item.src;
    p.image.alt = item.alt || "";

    document.body.classList.add("modal-open");
    if (!p.modal.open) p.modal.showModal();

    // Two rAFs, not a synchronous read right after showModal(): forcing
    // layout that early can collapse the backdrop's @starting-style frame
    // into the same tick as its target style, so the blur/dim snaps in
    // instead of transitioning alongside the zoom.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!isCurrent()) return;
        const toRect = p.photoBox.getBoundingClientRect();
        const liveTile = tile?.isConnected ? tile : null;
        // Empty the tile as the photo leaves it, in the same frame the ghost
        // appears - the photo is never in two places at once, and the hole
        // it leaves is what it flies back into on close.
        this.liftMosaicTile(liveTile);
        this.runFlight(liveTile?.querySelector("img") ?? p.image, liveTile?.getBoundingClientRect() ?? toRect, toRect, {
          leadMs: POLAROID().flight - POLAROID().frameLead,
          onLead: () => isCurrent() && p.panel.classList.remove("is-chrome-hidden"),
          onLanded: () => isCurrent() && p.panel.classList.remove("is-photo-hidden"),
        });
      });
    });
  },

  // Close: the card turns face up if it wasn't already, then the frame fades
  // out, then the photo flies back to its tile - the last two overlapping.
  closePolaroid() {
    const p = this._polaroid;
    if (!p?.modal.open || this._polaroidClosing) return;
    this._polaroidClosing = true;

    // A turned card doesn't turn back and then leave. It spins as it goes,
    // carrying its frame, and sheds that frame on the way - the whole
    // polaroid dropping back into the grid as a single motion. A card that
    // was already face up has nothing to turn, so it takes the plain route:
    // shed the frame first, then fly the bare photo home.
    if (this.isPolaroidFlipped()) this.runCardCloseFlight();
    else this.runCloseSequence();
  },

  // The turned-card close: no frame fade beforehand and no waiting for a
  // flip to finish - the card leaves immediately, turning and shrinking and
  // shedding its frame all at once.
  runCardCloseFlight() {
    const p = this._polaroid;
    const requestId = this._polaroidRequestId;

    // close() before measuring, same reasoning as runCloseSequence below.
    p.modal.close();

    const cardRect = p.card.querySelector(".polaroid__card").getBoundingClientRect();
    const photoRect = p.photoBox.getBoundingClientRect();
    const toRect = this.mosaicLandingRect(p.currentItem, photoRect);

    p.panel.classList.add("is-card-flying");
    this.runCardFlight(cardRect, photoRect, toRect, {
      onLanded: () => {
        if (requestId !== this._polaroidRequestId) return; // re-opened mid-flight
        // is-card-flying deliberately stays on: the dialog is still painted
        // for its keep-alive window after close(), so un-hiding the panel
        // here flashes the full-size card once the ghost has gone. The next
        // open clears it, which is the only time it's wanted back.
        this.resetPolaroidFlip(); // face up again, ready for that next open
        this.dropMosaicTile(); // photo is back in the grid, so fill its hole again
        this._polaroidClosing = false;
        this.setPolaroidBusy(false);
      },
    });
  },

  runCloseSequence() {
    const p = this._polaroid;
    const requestId = this._polaroidRequestId;

    p.panel.classList.add("is-chrome-hidden");

    this._polaroidCloseTimer = setTimeout(() => {
      // close() before measuring, for two reasons: it releases the body
      // scroll lock, so the rects describe the layout the photo actually
      // flies through, and it starts the backdrop's blur fading out
      // alongside the zoom instead of only once the zoom is over. The dialog
      // (and the ghost inside it) stays painted throughout thanks to
      // .polaroid-modal's own display/overlay transition in global.css.
      p.modal.close();

      const fromRect = p.photoBox.getBoundingClientRect();
      const toRect = this.mosaicLandingRect(p.currentItem, fromRect);

      p.panel.classList.add("is-photo-hidden");
      this.runFlight(p.image, fromRect, toRect, {
        onLanded: () => {
          if (requestId !== this._polaroidRequestId) return; // re-opened mid-flight
          this.dropMosaicTile(); // photo is back in the grid, so fill its hole again
          this._polaroidClosing = false;
          this.setPolaroidBusy(false);
        },
      });
    }, POLAROID().frameFade - POLAROID().closeLead);
  },

  // The FLIP zoom shared by both directions: a clone of an already-decoded
  // <img> is parked at `toRect`, given a starting transform that makes it
  // look like it's still at `fromRect`, then animated back to no transform -
  // i.e. to `toRect` itself.
  //
  // Cloning a live element rather than building a fresh <img src=...> is
  // deliberate: the clone paints from the already-decoded bitmap on its
  // first frame, where a brand new element can miss one and flash blank.
  // The scale is uniform (width-derived) so a source and destination that
  // don't share an aspect ratio start small rather than stretched.
  //
  // `onLead` fires `leadMs` in, before the landing, so a caller can start a
  // follow-up fade that overlaps the tail of the zoom.
  runFlight(sourceImg, fromRect, toRect, options = {}) {
    const ghost = sourceImg.cloneNode();
    ghost.removeAttribute("id"); // the polaroid's own <img> carries one
    ghost.className = "polaroid-flight-ghost";
    ghost.alt = "";
    ghost.loading = "eager";
    Object.assign(ghost.style, {
      left: `${toRect.left}px`,
      top: `${toRect.top}px`,
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
    });

    const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
    const scale = toRect.width ? fromRect.width / toRect.width : 1;

    this.beginFlight(
      ghost,
      (keyframes) => [ghost.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }], keyframes)],
      options
    );
  },

  // The turning variant, for putting a *turned* card back: the ghost is the
  // whole card rather than a bare photo, so it can spin front-to-back in 3D
  // on its way home. The wrapper takes the perspective and the FLIP
  // translate/scale, the cloned card inside it takes the rotation.
  //
  // It's the photo slot - not the card - that has to come down on the tile,
  // so the translation is worked out from where that slot ends up once the
  // card has been scaled about its own centre, not from the card's box.
  runCardFlight(cardRect, photoRect, toRect, { onLanded } = {}) {
    const p = this._polaroid;
    const { flight } = POLAROID();

    const ghost = document.createElement("div");
    ghost.className = "polaroid-flight-ghost polaroid-flight-ghost--card";
    Object.assign(ghost.style, {
      left: `${cardRect.left}px`,
      top: `${cardRect.top}px`,
      width: `${cardRect.width}px`,
      height: `${cardRect.height}px`,
    });
    // The frame dissolves over the back half of the flight (see below), so
    // the rules driving that fade are told to run at that length. Custom
    // properties only take via setProperty, never plain style assignment.
    ghost.style.setProperty("--polaroid-frame-fade", `${flight / 2}ms`);

    const card = p.card.querySelector(".polaroid__card").cloneNode(true);
    card.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    ghost.appendChild(card);

    const scale = photoRect.width ? toRect.width / photoRect.width : 1;
    const cardCx = cardRect.left + cardRect.width / 2;
    const cardCy = cardRect.top + cardRect.height / 2;
    const dx = toRect.left + toRect.width / 2 - cardCx - scale * (photoRect.left + photoRect.width / 2 - cardCx);
    const dy = toRect.top + toRect.height / 2 - cardCy - scale * (photoRect.top + photoRect.height / 2 - cardCy);

    this.beginFlight(
      ghost,
      (keyframes) => [
        ghost.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], keyframes),
        card.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], keyframes),
      ],
      {
        onLanded,
        // Frame starts dissolving as the card turns past edge-on - i.e. the
        // moment the photo is the side facing out - and finishes exactly as
        // it lands, so what settles into the tile is a bare photo and
        // nothing pops at touchdown.
        leadMs: flight / 2,
        onLead: () => ghost.classList.add("is-chrome-hidden"),
      }
    );
  },

  // Shared plumbing for both flight shapes: park the ghost, run its
  // animations as one unit, and make sure it's dropped whether it lands or
  // gets cancelled by a newer flight.
  beginFlight(ghost, createAnimations, { onLanded, onLead, leadMs } = {}) {
    this._polaroidFlight?.forEach((animation) => animation.cancel());
    clearTimeout(this._polaroidLeadTimer);

    ghost.setAttribute("aria-hidden", "true");
    // Inside the dialog, not the body: an open <dialog> paints in the top
    // layer, above every normal stacking context whatever the z-index.
    this._polaroid.modal.appendChild(ghost);

    const animations = createAnimations({ duration: POLAROID().flight, easing: POLAROID().easing, fill: "forwards" });
    this._polaroidFlight = animations;
    if (onLead) this._polaroidLeadTimer = setTimeout(onLead, Math.max(leadMs ?? 0, 0));

    const drop = () => {
      ghost.remove();
      if (this._polaroidFlight === animations) this._polaroidFlight = null;
    };
    // Two-arg then, not then().catch(): a flight cancelled by a newer one
    // still has to drop its ghost, but it must NOT report a landing - doing
    // so let an interrupted open reveal the full-size photo underneath the
    // close flight that had just replaced it.
    Promise.all(animations.map((animation) => animation.finished)).then(() => {
      drop();
      onLanded?.();
    }, drop);
  },

  // Where a closing photo flies back to: its own tile if that's still live
  // (the mosaic recycles constantly, so it's re-found rather than
  // remembered), otherwise a small box of the same shape near the bottom of
  // the mosaic, so it shrinks away into the grid instead of into a square.
  mosaicLandingRect(item, fromRect) {
    const tile = this._mosaicPool?.find((t) => t.isConnected && t._item === item);
    if (tile) return tile.getBoundingClientRect();

    const grid = this._mosaicGrid?.getBoundingClientRect();
    const width = fromRect.width * 0.12;
    const height = fromRect.height * 0.12;
    const cx = grid ? grid.left + grid.width / 2 : window.innerWidth / 2;
    const cy = grid ? Math.min(grid.bottom, window.innerHeight) : window.innerHeight;
    return new DOMRect(cx - width / 2, cy - height / 2, width, height);
  },

  // Flip state kept in one place so the button's label can't drift out of
  // step with the card - the close turns a flipped card back itself, not
  // just the button does.
  isPolaroidFlipped() {
    return this._polaroid.card.classList.contains("is-flipped");
  },

  setPolaroidFlipped(flipped) {
    const p = this._polaroid;
    p.card.classList.toggle("is-flipped", flipped);
    p.flipBtn.textContent = flipped ? "Turn back" : "Turn over";
  },

  // Turn the card face up with no animation. Used once a flying ghost has
  // taken over the visuals: the real card is hidden by then, so an animated
  // turn would just be a stale 800ms transition running underneath - and
  // still running, half-turned, if the next open comes quickly.
  resetPolaroidFlip() {
    const card = this._polaroid.card.querySelector(".polaroid__card");
    card.style.transition = "none";
    this.setPolaroidFlipped(false);
    void card.offsetWidth; // commit that state before the transition is allowed back
    card.style.transition = "";
  },

  // The tile whose photo is currently out in the polaroid sits empty (see
  // .mosaic-tile.is-lifted in global.css). Tracked as a single element
  // rather than derived from the item, because the tile has to be restored
  // even when the flight that emptied it gets superseded.
  liftMosaicTile(tile) {
    this.dropMosaicTile();
    if (!tile) return;
    this._liftedTile = tile;
    tile.classList.add("is-lifted");
  },

  dropMosaicTile() {
    this._liftedTile?.classList.remove("is-lifted");
    this._liftedTile = null;
  },

  // Busy spans the whole interaction, click through landing - the mosaic
  // must not recycle (reorder) tiles under an open or animating polaroid.
  setPolaroidBusy(busy) {
    this._polaroidBusy = busy;
    clearTimeout(this._mosaicResumeTimer);

    if (busy) {
      this._mosaicGrid?.classList.remove("is-hovering");
      return;
    }
    if (!this._mosaicGrowPending) return;
    this._mosaicGrowPending = false;
    // Deferred, so the reflow it causes doesn't land on top of the photo
    // that has just flown back into place.
    this._mosaicResumeTimer = setTimeout(() => this.growOrRecycleMosaic(), 350);
  },

  fillPolaroid(item) {
    const p = this._polaroid;
    const shown = (value) => (value && value.trim() ? value : "N/A");

    p.place.textContent = shown(item.place);
    p.date.textContent = shown(this.formatDateDisplay(item.date));
    p.story.textContent = shown(item.story);
    p.camera.textContent = shown(item.camera);
    p.shutter.textContent = shown(item.shutter);
    p.aperture.textContent = shown(item.aperture);
    p.iso.textContent = shown(item.iso);
  },

  // The clicked tile's <img> is on screen, so it is already loaded - reading
  // the aspect straight off it keeps the whole open path synchronous.
  // Awaiting a fresh probe image instead is what used to make the zoom visibly
  // hang after the click.
  resolveAspect(item, tile) {
    const cached = this._aspectCache.get(item.src);
    if (cached) return cached;

    const img = tile?.querySelector("img");
    if (img?.naturalWidth) {
      const aspect = img.naturalWidth / img.naturalHeight;
      this._aspectCache.set(item.src, aspect);
      return aspect;
    }
    return this.loadImageAspect(item.src); // no live tile to measure
  },

  loadImageAspect(src) {
    if (this._aspectCache.has(src)) return Promise.resolve(this._aspectCache.get(src));

    return new Promise((resolve) => {
      const probe = new Image();
      const finish = (aspect) => {
        this._aspectCache.set(src, aspect);
        resolve(aspect);
      };
      probe.onload = () => finish(probe.naturalWidth / probe.naturalHeight || 4 / 3);
      probe.onerror = () => finish(4 / 3);
      probe.src = src;
      if (probe.complete && probe.naturalWidth) finish(probe.naturalWidth / probe.naturalHeight);
    });
  },

  // The grid/filter markup itself is now rendered by Astro at build time
  // (src/pages/photos/index.astro) - this only wires up interactivity on
  // top of what's already in the DOM: toggling which already-rendered
  // cards are visible per filter (instead of re-building the grid's HTML
  // on every click), and opening the lightbox.
  initPhotosPage() {
    const filterBar = document.getElementById("photo-filters");
    const grid = document.getElementById("photos-grid");
    const emptyState = document.getElementById("photos-empty");
    this._photos = this.readEmbeddedJson("photos-data");
    if (!filterBar || !grid) return;

    const cards = Array.from(grid.querySelectorAll(".photo-card"));

    const applyFilter = (category) => {
      let visibleCount = 0;
      cards.forEach((card) => {
        const matches = category === "All" || card.dataset.category === category;
        card.hidden = !matches;
        if (matches) visibleCount++;
      });
      if (emptyState) emptyState.hidden = visibleCount > 0;
    };

    filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        applyFilter(btn.dataset.category);
      });
    });

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        const project = this._photos?.projects?.find((p) => p.slug === card.dataset.project);
        if (project) this.openLightbox(project, 0);
      });
    });

    this.initLightbox();
    this.handlePhotoHash();
  },

  handlePhotoHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;

    const project = this._photos?.projects?.find((p) => p.slug === hash);
    if (project) {
      requestAnimationFrame(() => this.openLightbox(project, 0));
    }
  },

  // Static markup (photos/index.astro), native <dialog> for real focus
  // trapping/ESC-to-close - same reasoning as initPolaroid above, including
  // the element-identity guard (this._lightboxBoundEl) so a fresh dialog
  // after a View Transitions navigation gets rewired instead of skipped.
  initLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox || lightbox === this._lightboxBoundEl) return;
    this._lightboxBoundEl = lightbox;

    this.lightbox = {
      el: lightbox,
      title: lightbox.querySelector("#lightbox-title"),
      counter: lightbox.querySelector("#lightbox-counter"),
      image: lightbox.querySelector("#lightbox-image"),
      captionTitle: lightbox.querySelector("#lightbox-caption-title"),
      caption: lightbox.querySelector("#lightbox-caption"),
      close: lightbox.querySelector("#lightbox-close"),
      prev: lightbox.querySelector("#lightbox-prev"),
      next: lightbox.querySelector("#lightbox-next"),
      project: null,
      index: 0,
    };

    this.lightbox.close.addEventListener("click", () => this.closeLightbox());
    this.lightbox.prev.addEventListener("click", () => this.navigateLightbox(-1));
    this.lightbox.next.addEventListener("click", () => this.navigateLightbox(1));

    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) this.closeLightbox();
    });

    // One `close` handler covers every way the dialog can close (button,
    // backdrop click, or native ESC) instead of duplicating this cleanup.
    lightbox.addEventListener("close", () => {
      document.body.classList.remove("lightbox-open");
      history.replaceState(null, "", window.location.pathname);
    });

    this.initLightboxKeysOnce();
  },

  // Arrow-key navigation isn't an open/close concern (dialogs don't have
  // anything built in for it), so it's still manual - but bound to
  // `document` exactly once: document, unlike page content, isn't replaced
  // by a View Transitions navigation, so binding this inside initLightbox()
  // (which reruns per visit) would add one more listener every time the
  // photos page is revisited in the same session. Reading this.lightbox
  // fresh on every keypress instead of closing over one visit's dialog
  // keeps it correct regardless of how many times the lightbox is rebuilt.
  initLightboxKeysOnce() {
    if (this._lightboxKeysBound) return;
    this._lightboxKeysBound = true;
    document.addEventListener("keydown", (e) => {
      if (!this.lightbox?.el.open) return;
      if (e.key === "ArrowLeft") this.navigateLightbox(-1);
      if (e.key === "ArrowRight") this.navigateLightbox(1);
    });
  },

  openLightbox(project, index = 0) {
    this.initLightbox();

    this.lightbox.project = project;
    this.lightbox.index = index;
    this.updateLightbox();
    document.body.classList.add("lightbox-open");
    if (!this.lightbox.el.open) this.lightbox.el.showModal();
    history.replaceState(null, "", `#${project.slug}`);
  },

  closeLightbox() {
    if (this.lightbox?.el.open) this.lightbox.el.close();
  },

  navigateLightbox(direction) {
    if (!this.lightbox?.project) return;
    const total = this.lightbox.project.images.length;
    this.lightbox.index = (this.lightbox.index + direction + total) % total;
    this.updateLightbox();
  },

  updateLightbox() {
    const { project, index } = this.lightbox;
    const image = project.images[index];

    this.lightbox.title.textContent = project.title;
    this.lightbox.counter.textContent = `${index + 1} / ${project.images.length}`;
    this.lightbox.image.src = image.src;
    this.lightbox.image.alt = image.alt;
    this.lightbox.captionTitle.textContent = image.title || "";
    this.lightbox.caption.textContent = image.caption || "";
  },

  // Reveals the header's play/pause control (hidden by default - see
  // Header.astro - so it never shows up on pages with no video background)
  // and wires it to pause/resume every clip in the stack at once. Also
  // respects prefers-reduced-motion: if set, the videos start paused
  // instead of autoplaying, same spirit as the reduced-motion block in
  // global.css that already turns off CSS animations/transitions.
  initBackgroundVideoToggle(stack) {
    const toggle = document.getElementById("bg-toggle");
    if (!toggle || !stack) return;

    const videos = () => stack.querySelectorAll("video");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Force a real reload before playing, every time this runs (i.e. every
    // page-load, View Transitions or not). Without this, whether the video
    // actually starts is a coin flip after a client-side navigation: Astro
    // can morph/reuse an existing <video> element instead of replacing it,
    // and simply having a different `src` attribute doesn't reliably
    // restart a media element's load - the browser needs an explicit
    // .load() to reset that pipeline. These are silent, muted, looping
    // ambient clips, so resetting playback to 0:00 on every visit is
    // unnoticeable - there's no meaningful position to preserve.
    const tryPlay = (video) => {
      video.load();
      const play = () => video.play().catch(() => {});
      play();
      // Belt and suspenders: if play() was rejected because there wasn't
      // enough data buffered yet (readyState was still HAVE_NOTHING), try
      // again once the browser says it actually has something to play.
      video.addEventListener("canplay", play, { once: true });
    };

    const setPaused = (paused) => {
      videos().forEach((video) => (paused ? video.pause() : tryPlay(video)));
      toggle.classList.toggle("is-paused", paused);
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.setAttribute("aria-label", paused ? "Resume background videos" : "Pause background videos");
    };

    toggle.hidden = false;
    setPaused(reducedMotion);

    if (!toggle._bgToggleBound) {
      toggle._bgToggleBound = true;
      toggle.addEventListener("click", () => setPaused(!toggle.classList.contains("is-paused")));
    }
  },

  // The featured player, "more videos" grid (if re-enabled), and playlist
  // rows are all rendered by Astro at build time now (see
  // src/pages/videos/index.astro) - this only wires up interactivity on
  // top of what's already in the DOM.
  initVideosPage() {
    this.initBackgroundVideoToggle(document.getElementById("video-bg-stack"));

    const featured = document.getElementById("video-featured");
    const grid = document.getElementById("video-grid"); // currently disabled - see the .astro page

    if (featured && grid) {
      grid.querySelectorAll(".video-card__thumb").forEach((btn) => {
        btn.addEventListener("click", () => {
          featured.scrollIntoView({ behavior: "smooth" });
          featured.querySelector("iframe").src = `https://www.youtube.com/embed/${btn.dataset.videoId}?rel=0&autoplay=1`;
          featured.querySelector(".video-featured__title").textContent = btn.dataset.videoTitle || "";
          featured.querySelector(".video-featured__date").textContent = btn.dataset.videoDate || "";
          featured.querySelector(".video-featured__description").textContent = btn.dataset.videoDescription || "";
        });
      });
    }

    document.querySelectorAll(".playlist-card").forEach((card) => {
      card.addEventListener("click", () => {
        this.openVideoModal(card.dataset.videoId, card.dataset.videoTitle);
      });
    });

    this.initInfiniteScrollers();
  },

  // Makes each looped playlist row scroll endlessly in both directions
  // without ever growing the DOM or re-fetching anything while scrolling.
  //
  // Each row was rendered as [clone tail][real videos][clone head] - a
  // fixed, small, one-time set of nodes (LOOP_BUFFER_CARDS on each side,
  // reusing the same thumbnail URLs as their real counterparts, so the
  // browser's own image cache serves them with no extra network cost).
  // Nothing is ever added, removed, or reassigned while the user scrolls:
  // we just watch scrollLeft and, whenever it drifts into a clone buffer,
  // jump it by exactly one real-content width. Because every clone mirrors
  // the real card at the equivalent wrapped position, the frame after the
  // jump is pixel-identical to the frame before it - so the jump is
  // invisible, and the same fixed set of nodes can be scrolled forever.
  initInfiniteScrollers() {
    const scrollers = document.querySelectorAll('.playlist-row__scroller[data-loop="true"]');

    const entries = Array.from(scrollers)
      .map((scroller) => ({ scroller, realCount: Number(scroller.dataset.realCount) || 0, cardWidth: 0 }))
      .filter((entry) => entry.realCount > 0);

    // Replaced, not accumulated, on every call: this runs once per fresh
    // page view (View Transitions or not), and the previous page's
    // scrollers - if this is a revisit - are gone with the old DOM.
    // Concatenating would grow this array by a row-count's worth of dead
    // entries every time someone revisits the videos page in one session.
    this._loopEntries = entries;

    const measure = (entry) => {
      entry.cardWidth = entry.scroller.children[0]?.getBoundingClientRect().width || 0;
    };

    entries.forEach((entry) => {
      measure(entry);
      if (!entry.cardWidth || entry.scroller._loopBound) return;
      entry.scroller._loopBound = true;

      entry.scroller.scrollLeft = LOOP_BUFFER_CARDS * entry.cardWidth;

      let ticking = false;
      entry.scroller.addEventListener(
        "scroll",
        () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            const bufferWidth = LOOP_BUFFER_CARDS * entry.cardWidth;
            const realWidth = entry.realCount * entry.cardWidth;
            let x = entry.scroller.scrollLeft;
            while (x < bufferWidth) x += realWidth;
            while (x >= bufferWidth + realWidth) x -= realWidth;
            if (x !== entry.scroller.scrollLeft) entry.scroller.scrollLeft = x;
          });
        },
        { passive: true }
      );
    });

    // One-time (not per-visit) resize listener; it always reads
    // this._loopEntries fresh, so it stays correct across however many
    // times this page gets (re)initialized.
    if (!this._loopResizeBound) {
      this._loopResizeBound = true;
      window.addEventListener("resize", () => {
        clearTimeout(this._playlistResizeTimer);
        this._playlistResizeTimer = setTimeout(() => {
          this._loopEntries.forEach((entry) => {
            if (!entry.cardWidth) return;
            const cardIndex = Math.round(entry.scroller.scrollLeft / entry.cardWidth);
            measure(entry);
            if (entry.cardWidth) entry.scroller.scrollLeft = cardIndex * entry.cardWidth;
          });
        }, 200);
      });
    }
  },

  // Lazily loads the IFrame Player API script once and resolves when
  // window.YT is ready to construct players with.
  loadYouTubeIframeApi() {
    if (this._youtubeApiPromise) return this._youtubeApiPromise;

    this._youtubeApiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === "function") previousCallback();
        resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });

    return this._youtubeApiPromise;
  },

  // Static markup (videos/index.astro), native <dialog> - same reasoning
  // as initPolaroid/initLightbox above, including the element-identity
  // guard (this._videoModalBoundEl) so a fresh dialog after a View
  // Transitions navigation gets rewired instead of skipped. Also destroys
  // any previous visit's leftover YT.Player - it was bound to the old,
  // now-detached #youtube-player div, so it can't be reused either way.
  initVideoModal() {
    const modal = document.getElementById("video-modal");
    if (!modal || modal === this._videoModalBoundEl) return;
    this._videoModalBoundEl = modal;

    this._videoModal?.player?.destroy?.();
    this._videoModal = {
      el: modal,
      title: modal.querySelector("#video-modal-title"),
      player: null,
    };

    modal.querySelector("#video-modal-close").addEventListener("click", () => this.closeVideoModal());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) this.closeVideoModal();
    });

    // One `close` handler covers every way the dialog can close (button,
    // backdrop click, or native ESC) instead of duplicating this cleanup.
    modal.addEventListener("close", () => {
      document.body.classList.remove("modal-open");
      this._videoModal.player?.stopVideo?.();
    });
  },

  async openVideoModal(videoId, title) {
    this.initVideoModal();
    const m = this._videoModal;

    m.title.textContent = title || "";
    document.body.classList.add("modal-open");
    if (!m.el.open) m.el.showModal();

    const YT = await this.loadYouTubeIframeApi();

    if (m.player) {
      m.player.loadVideoById(videoId);
    } else {
      m.player = new YT.Player("youtube-player", {
        videoId,
        playerVars: { rel: 0, playsinline: 1, autoplay: 1 },
      });
    }
  },

  closeVideoModal() {
    if (this._videoModal?.el.open) this._videoModal.el.close();
  },

  initContactForm() {
    const form = document.getElementById("contact-form");
    const status = document.getElementById("form-status");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (status) status.textContent = "Sending…";

      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;

      const data = new FormData(form);
      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            email: data.get("email"),
            message: data.get("message"),
          }),
        });
        const result = await res.json().catch(() => ({}));

        if (res.ok && result.ok) {
          if (status) status.textContent = "Thank you — your message has been sent.";
          form.reset();
        } else {
          if (status) status.textContent = result.error || "Something went wrong. Please try again.";
        }
      } catch {
        if (status) status.textContent = "Something went wrong. Please try again.";
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  },
};

// `astro:page-load` fires once for the very first load AND after every
// subsequent View Transitions navigation (Astro wires it to the window's
// native `load` event for the first case, and dispatches it again after
// every swap for the rest - confirmed in astro/dist/transitions/router.js).
// Since Astro recognizes this script as unchanged across pages and never
// re-runs the module itself, this is the only hook that gets init() to run
// again on navigation.
document.addEventListener("astro:page-load", () => Site.init());
