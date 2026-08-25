import { LOOP_BUFFER_CARDS } from "../lib/constants.js";

// Everything that used to be fetched at runtime (photos.json, videos.json,
// mosaic-items.json, youtube-playlists.json, background-videos.json) is now
// either rendered directly into the page HTML by Astro, or - where client
// JS genuinely needs the raw dataset (the mosaic's recycling pool, the
// photo lightbox's prev/next navigation) - embedded as an inline
// <script type="application/json"> data island by the relevant .astro
// page. Either way, there's no more fetch() waterfall on page load.
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
      if (!this.focusMode) return;
      this._mosaicGrid.classList.add("is-hovering");
      tile.classList.add("is-focused");
    });
    tile.addEventListener("mouseleave", () => {
      this._mosaicGrid.classList.remove("is-hovering");
      tile.classList.remove("is-focused");
    });
    tile.addEventListener("click", () => {
      if (!this.focusMode) return;
      if (tile._item) this.openPolaroid(tile._item);
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
      backDate: modal.querySelector("#polaroid-back-date"),
      backPlace: modal.querySelector("#polaroid-back-place"),
      flipBtn: modal.querySelector("#polaroid-flip"),
    };

    this._polaroid.flipBtn.addEventListener("click", () => {
      const isFlipped = this._polaroid.card.classList.toggle("is-flipped");
      this._polaroid.flipBtn.textContent = isFlipped ? "Turn back" : "Turn over";
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

  async openPolaroid(item) {
    this.initPolaroid();
    const p = this._polaroid;
    const empty = (value) => (value && value.trim() ? value : "N/A");

    const requestId = (this._polaroidRequestId = (this._polaroidRequestId || 0) + 1);

    p.card.classList.remove("is-flipped");
    p.flipBtn.textContent = "Turn over";

    const displayDate = this.formatDateDisplay(item.date);

    p.place.textContent = empty(item.place);
    p.date.textContent = empty(displayDate);
    p.story.textContent = empty(item.story);
    p.camera.textContent = empty(item.camera);
    p.shutter.textContent = empty(item.shutter);
    p.aperture.textContent = empty(item.aperture);
    p.iso.textContent = empty(item.iso);
    p.backDate.textContent = empty(displayDate);
    p.backPlace.textContent = empty(item.place);

    // Resolve real dimensions before showing anything, so the card never
    // renders at a placeholder size and then visibly resizes.
    const aspect = await this.loadImageAspect(item.src);
    if (requestId !== this._polaroidRequestId) return; // a newer click superseded this one

    p.photoBox.style.aspectRatio = String(aspect);
    p.backPhotoBox.style.aspectRatio = String(aspect);
    this.sizePolaroid(aspect);
    p.image.src = item.src;
    p.image.alt = item.alt || "";

    document.body.classList.add("modal-open");
    if (!p.modal.open) p.modal.showModal();
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

  closePolaroid() {
    // body class cleanup happens in the dialog's "close" listener (see
    // initPolaroid) - covers this call, the close button, backdrop clicks,
    // and native ESC all in one place.
    if (this._polaroid?.modal.open) this._polaroid.modal.close();
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

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (status) {
        status.textContent = "Thank you — your message has been noted. Connect a form service like Formspree to send emails.";
      }
      form.reset();
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
