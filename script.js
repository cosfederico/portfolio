// Clone cards padded onto each end of a looped playlist row (see
// initInfiniteScrollers). Fixed and small on purpose: enough clones must be
// visible on both sides of a scroll-jump for it to be seamless, so this
// needs to cover one full row's width - 14 cards (~3640px at the desktop
// card width) comfortably covers even ultrawide monitors. It never grows
// past this, so the DOM/memory cost per row is constant no matter how far -
// or how long - someone scrolls.
const LOOP_BUFFER_CARDS = 14;

const Site = {
  photos: null,
  videos: null,
  mosaic: null,
  site: null,
  channelPlaylists: null,
  focusMode: false,
  _aspectCache: new Map(),

  async init() {
    this.setYear();
    await this.loadHeader();
    this.initHeaderBehavior();
    this.initReveal();
    await this.loadData();
    this.initPage();
    this.initContactForm();
  },

  setYear() {
    const year = document.getElementById("year");
    if (year) year.textContent = new Date().getFullYear();
  },

  async loadHeader() {
    const placeholder = document.getElementById("site-header-placeholder");
    if (!placeholder) return;

    try {
      const response = await fetch("/header.html");
      if (!response.ok) return;
      placeholder.innerHTML = await response.text();
      this.markActiveNav();
      this.initMobileNav();
    } catch (error) {
      console.error("Failed to load header", error);
    }
  },

  markActiveNav() {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    document.querySelectorAll(".site-nav a[href]").forEach((link) => {
      const href = link.getAttribute("href").replace(/\/$/, "") || "/";
      link.classList.toggle("is-active", href === path);
    });
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

  initHeaderBehavior() {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 40);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  },

  initReveal() {
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
  },

  async loadData() {
    const fetchJson = async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        return await res.json();
      } catch {
        return null;
      }
    };

    [this.photos, this.videos, this.mosaic, this.site, this.channelPlaylists] = await Promise.all([
      fetchJson("/data/photos.json"),
      fetchJson("/data/videos.json"),
      fetchJson("/data/mosaic-items.json"),
      fetchJson("/data/site.json"),
      fetchJson("/data/youtube-playlists.json"),
    ]);
  },

  initPage() {
    const page = document.body.dataset.page;
    switch (page) {
      case "home":
        this.initMosaic();
        this.initFocusToggle();
        break;
      case "photos":
        this.renderPhotosPage();
        break;
      case "videos":
        this.renderVideosPage();
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
  initMosaic() {
    const grid = document.getElementById("home-mosaic-grid");
    if (!grid || !this.mosaic?.length || this._mosaicInitialized) return;
    this._mosaicInitialized = true;

    this._mosaicGrid = grid;
    this._mosaicImages = [...this.mosaic].sort(() => Math.random() - 0.5);
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

    window.addEventListener("resize", () => {
      clearTimeout(this._mosaicResizeTimer);
      this._mosaicResizeTimer = setTimeout(() => this.growOrRecycleMosaic(), 250);
    });
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

    toggle.addEventListener("click", () => {
      this.focusMode = !this.focusMode;
      toggle.classList.toggle("is-on", this.focusMode);
      toggle.setAttribute("aria-checked", String(this.focusMode));
      document.body.classList.toggle("focus-mode-on", this.focusMode);
      if (grid) grid.classList.toggle("focus-enabled", this.focusMode);
      if (!this.focusMode) grid?.classList.remove("is-hovering");
    });
  },

  initPolaroid() {
    const modal = document.getElementById("polaroid-modal");
    if (!modal || this._polaroid) return;

    modal.innerHTML = `
      <div class="polaroid-panel">
        <div class="polaroid" id="polaroid">
          <div class="polaroid__card">
            <div class="polaroid__face polaroid__front">
              <div class="polaroid__photo">
                <img id="polaroid-image" src="" alt="" />
              </div>
              <div class="polaroid__caption">
                <p class="polaroid__place" id="polaroid-place"></p>
                <p class="polaroid__date" id="polaroid-date"></p>
                <p class="polaroid__story" id="polaroid-story"></p>
              </div>
            </div>
            <div class="polaroid__face polaroid__back">
              <div class="polaroid__back-photo">
                <table class="polaroid__meta-table">
                  <tbody>
                    <tr>
                      <td>
                        <div class="polaroid__meta-cell">
                          <span class="polaroid__meta-value" id="polaroid-camera"></span>
                          <span class="polaroid__meta-label">Camera</span>
                        </div>
                      </td>
                      <td>
                        <div class="polaroid__meta-cell">
                          <span class="polaroid__meta-value" id="polaroid-aperture"></span>
                          <span class="polaroid__meta-label">Aperture</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <div class="polaroid__meta-cell">
                          <span class="polaroid__meta-value" id="polaroid-shutter"></span>
                          <span class="polaroid__meta-label">Shutter</span>
                        </div>
                      </td>
                      <td>
                        <div class="polaroid__meta-cell">
                          <span class="polaroid__meta-value" id="polaroid-iso"></span>
                          <span class="polaroid__meta-label">ISO</span>
                        </div>
                      </td>
                    </tr>
                    <tr><td id="polaroid-back-date"></td><td id="polaroid-back-place"></td></tr>
                  </tbody>
                </table>
              </div>
              <div class="polaroid__back-blank" aria-hidden="true"></div>
            </div>
          </div>
        </div>
        <div class="polaroid-actions">
          <button type="button" class="polaroid-actions__btn polaroid-actions__btn--flip" id="polaroid-flip">Turn over</button>
          <button type="button" class="polaroid-actions__btn polaroid-actions__btn--close" id="polaroid-close">Put back</button>
        </div>
      </div>`;

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
    modal.addEventListener("click", (e) => {
      if (e.target === modal) this.closePolaroid();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) this.closePolaroid();
    });

    window.addEventListener("resize", () => {
      if (!modal.hidden && this._polaroid.currentAspect) {
        this.sizePolaroid(this._polaroid.currentAspect);
      }
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

    p.modal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => p.modal.classList.add("is-open"));
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
    const p = this._polaroid;
    if (!p) return;
    p.modal.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      if (!p.modal.classList.contains("is-open")) p.modal.hidden = true;
    }, 450);
  },

  renderPhotosPage() {
    const filterBar = document.getElementById("photo-filters");
    const grid = document.getElementById("photos-grid");
    if (!grid || !this.photos?.projects?.length) return;

    const categories = this.photos.categories || ["All"];
    let activeCategory = "All";

    const renderFilters = () => {
      if (!filterBar) return;
      filterBar.innerHTML = categories
        .map(
          (cat) =>
            `<button class="filter-btn${cat === activeCategory ? " is-active" : ""}" data-category="${cat}">${cat}</button>`
        )
        .join("");

      filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeCategory = btn.dataset.category;
          renderFilters();
          renderGrid();
        });
      });
    };

    const renderGrid = () => {
      const projects =
        activeCategory === "All"
          ? this.photos.projects
          : this.photos.projects.filter((p) => p.category === activeCategory);

      if (!projects.length) {
        grid.innerHTML = '<p class="empty-state">No projects in this category yet.</p>';
        return;
      }

      grid.innerHTML = projects
        .map(
          (project, i) => `
          <button class="photo-card reveal" data-project="${project.slug}" style="transition-delay: ${i * 0.06}s">
            <div class="photo-card__image">
              <img src="${project.cover}" alt="${project.title}" loading="lazy" decoding="async" />
            </div>
            <span class="photo-card__count">${project.images.length} images</span>
            <div class="photo-card__info">
              <h3>${project.title}</h3>
              <p>${project.category} · ${project.year}</p>
            </div>
          </button>`
        )
        .join("");

      grid.querySelectorAll(".photo-card").forEach((card) => {
        card.addEventListener("click", () => {
          const project = this.photos.projects.find((p) => p.slug === card.dataset.project);
          if (project) this.openLightbox(project, 0);
        });
      });

      this.initReveal();
      this.handlePhotoHash();
    };

    renderFilters();
    renderGrid();
    this.initLightbox();
  },

  handlePhotoHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;

    const project = this.photos?.projects?.find((p) => p.slug === hash);
    if (project) {
      requestAnimationFrame(() => this.openLightbox(project, 0));
    }
  },

  initLightbox() {
    if (document.getElementById("lightbox")) return;

    const lightbox = document.createElement("div");
    lightbox.id = "lightbox";
    lightbox.className = "lightbox";
    lightbox.hidden = true;
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.innerHTML = `
      <div class="lightbox__header">
        <h2 class="lightbox__title" id="lightbox-title"></h2>
        <span class="lightbox__counter" id="lightbox-counter"></span>
        <button class="lightbox__close" id="lightbox-close" aria-label="Close gallery">&times;</button>
      </div>
      <div class="lightbox__stage">
        <button class="lightbox__nav lightbox__nav--prev" id="lightbox-prev" aria-label="Previous image">&#8592;</button>
        <div class="lightbox__image-wrap">
          <img id="lightbox-image" src="" alt="" />
        </div>
        <button class="lightbox__nav lightbox__nav--next" id="lightbox-next" aria-label="Next image">&#8594;</button>
      </div>
      <div class="lightbox__footer">
        <p class="lightbox__caption-title" id="lightbox-caption-title"></p>
        <p class="lightbox__caption" id="lightbox-caption"></p>
      </div>`;

    document.body.appendChild(lightbox);

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

    document.addEventListener("keydown", (e) => {
      if (lightbox.hidden) return;
      if (e.key === "Escape") this.closeLightbox();
      if (e.key === "ArrowLeft") this.navigateLightbox(-1);
      if (e.key === "ArrowRight") this.navigateLightbox(1);
    });
  },

  openLightbox(project, index = 0) {
    if (!this.lightbox) this.initLightbox();

    this.lightbox.project = project;
    this.lightbox.index = index;
    this.updateLightbox();
    this.lightbox.el.hidden = false;
    document.body.classList.add("lightbox-open");
    history.replaceState(null, "", `#${project.slug}`);
  },

  closeLightbox() {
    if (!this.lightbox) return;
    this.lightbox.el.hidden = true;
    document.body.classList.remove("lightbox-open");
    history.replaceState(null, "", window.location.pathname);
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

  renderVideosPage() {
    const featured = document.getElementById("video-featured");
    const grid = document.getElementById("video-grid");
    if (!this.videos?.length) return;

    const featuredVideo = this.videos.find((v) => v.featured) || this.videos[0];
    const rest = this.videos.filter((v) => v.id !== featuredVideo.id);

    if (featured) {
      featured.innerHTML = `
        <div class="video-featured__player reveal">
          <iframe
            src="https://www.youtube.com/embed/${featuredVideo.youtubeId}?rel=0"
            title="${featuredVideo.title}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy"
          ></iframe>
        </div>
        <div class="video-featured__info reveal">
          <p class="eyebrow">Featured video · ${featuredVideo.year}</p>
          <h2>${featuredVideo.title}</h2>
          <p class="lead">${featuredVideo.description}</p>
        </div>`;
    }

    if (grid) {
      grid.innerHTML = rest
        .map(
          (video, i) => `
          <article class="video-card reveal" style="transition-delay: ${i * 0.08}s">
            <button class="video-card__thumb" data-video-id="${video.youtubeId}" aria-label="Play ${video.title}">
              <img
                src="https://img.youtube.com/vi/${video.youtubeId}/maxresdefault.jpg"
                alt="${video.title}"
                loading="lazy"
                onerror="this.src='https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg'"
              />
              <span class="video-card__play"><span class="video-card__play-icon"></span></span>
            </button>
            <div class="video-card__body">
              <p class="video-card__meta">${video.year}</p>
              <h3>${video.title}</h3>
              <p>${video.description}</p>
            </div>
          </article>`
        )
        .join("");

      grid.querySelectorAll(".video-card__thumb").forEach((btn) => {
        btn.addEventListener("click", () => {
          const videoId = btn.dataset.videoId;
          const video = this.videos.find((v) => v.youtubeId === videoId);
          if (video && featured) {
            featured.scrollIntoView({ behavior: "smooth" });
            featured.querySelector("iframe").src = `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1`;
            featured.querySelector("h2").textContent = video.title;
            featured.querySelector(".lead").textContent = video.description;
            featured.querySelector(".eyebrow").textContent = `Featured video · ${video.year}`;
          }
        });
      });
    }

    this.initReveal();
    this.renderChannelPlaylists();
  },

  // Netflix/channel-style rows: one row per playlist, thumbnails scroll
  // horizontally, clicking one opens the shared player modal via the
  // YouTube IFrame Player API instead of the inline featured embed above.
  renderChannelPlaylists() {
    const container = document.getElementById("channel-playlists");
    if (!container) return;

    const playlists = this.channelPlaylists?.playlists || [];
    if (!playlists.length) {
      container.innerHTML = '<p class="empty-state">No playlists yet - run scripts/fetch_youtube_playlists.py to pull them from YouTube.</p>';
      return;
    }

    const buildCard = (video, isClone) => `
      <button
        class="playlist-card"
        data-video-id="${video.id}"
        data-video-title="${video.title.replace(/"/g, "&quot;")}"
        aria-label="Play ${video.title}"
        ${isClone ? 'aria-hidden="true" tabindex="-1"' : ""}
      >
        <span class="playlist-card__thumb">
          <img src="${video.thumbnail}" alt="${video.title}" loading="lazy" />
          <span class="playlist-card__play"><span class="video-card__play-icon"></span></span>
        </span>
        <span class="playlist-card__title">${video.title}</span>
      </button>`;

    container.innerHTML = playlists
      .map((playlist) => {
        const videos = playlist.videos;
        // Looping only makes sense with more than one video - a single one
        // would just repeat itself. Below LOOP_BUFFER_CARDS, wrappedSlice
        // cycles back through the same short list to still fill the buffer.
        const canLoop = videos.length >= 2;
        const before = canLoop ? this.wrappedSlice(videos, -LOOP_BUFFER_CARDS, LOOP_BUFFER_CARDS) : [];
        const after = canLoop ? this.wrappedSlice(videos, videos.length, LOOP_BUFFER_CARDS) : [];

        return `
        <section class="playlist-row reveal" aria-label="${playlist.title}">
          <h3 class="playlist-row__title">${playlist.title}</h3>
          <div class="playlist-row__scroller" data-loop="${canLoop}" data-real-count="${videos.length}">
            ${before.map((v) => buildCard(v, true)).join("")}
            ${videos.map((v) => buildCard(v, false)).join("")}
            ${after.map((v) => buildCard(v, true)).join("")}
          </div>
        </section>`;
      })
      .join("");

    container.querySelectorAll(".playlist-card").forEach((card) => {
      card.addEventListener("click", () => {
        this.openVideoModal(card.dataset.videoId, card.dataset.videoTitle);
      });
    });

    this.initReveal();
    this.initInfiniteScrollers();
  },

  // Returns `length` items from `list`, starting at `start` (which may be
  // negative or beyond list.length) and wrapping around as many times as
  // needed. Used to build the clone buffers below.
  wrappedSlice(list, start, length) {
    const n = list.length;
    const out = [];
    for (let i = 0; i < length; i++) {
      out.push(list[(((start + i) % n) + n) % n]);
    }
    return out;
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

    // `_loopBound` guards each scroller against getting a second scroll
    // listener if this is ever called again for the same row; entries are
    // accumulated on `this` (rather than captured only in this call's
    // closure) so the one shared resize listener below always covers every
    // row that has ever been initialized, not just the latest batch.
    const entries = Array.from(scrollers)
      .filter((scroller) => !scroller._loopBound)
      .map((scroller) => ({ scroller, realCount: Number(scroller.dataset.realCount) || 0, cardWidth: 0 }))
      .filter((entry) => entry.realCount > 0);
    if (!entries.length) return;

    const measure = (entry) => {
      entry.cardWidth = entry.scroller.children[0]?.getBoundingClientRect().width || 0;
    };

    entries.forEach((entry) => {
      entry.scroller._loopBound = true;
      measure(entry);
      if (!entry.cardWidth) return;

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

    this._loopEntries = (this._loopEntries || []).concat(entries);

    // One resize listener total, no matter how many rows/times this runs.
    if (!this._loopResizeBound) {
      this._loopResizeBound = true;
      window.addEventListener("resize", () => {
        // Card width only actually changes when the responsive breakpoint
        // flips (e.g. crossing 768px), not on every resize tick, but
        // re-measuring is cheap - keep the same card visible rather than
        // just re-centering.
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

  initVideoModal() {
    if (this._videoModal) return;

    const modal = document.createElement("div");
    modal.className = "video-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="video-modal__panel">
        <div class="video-modal__stage">
          <div id="youtube-player"></div>
        </div>
        <div class="video-modal__footer">
          <h3 class="video-modal__title" id="video-modal-title"></h3>
          <button type="button" class="video-modal__close" id="video-modal-close" aria-label="Close video">&times;</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    this._videoModal = {
      el: modal,
      title: modal.querySelector("#video-modal-title"),
      player: null,
    };

    modal.querySelector("#video-modal-close").addEventListener("click", () => this.closeVideoModal());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) this.closeVideoModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) this.closeVideoModal();
    });
  },

  async openVideoModal(videoId, title) {
    this.initVideoModal();
    const m = this._videoModal;

    m.title.textContent = title || "";
    m.el.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => m.el.classList.add("is-open"));

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
    const m = this._videoModal;
    if (!m) return;
    m.el.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    if (m.player?.stopVideo) m.player.stopVideo();
    // Let the fade-out transition (see .video-modal.is-open in styles.css)
    // finish before actually hiding it - display:none can't be transitioned.
    setTimeout(() => {
      if (!m.el.classList.contains("is-open")) m.el.hidden = true;
    }, 450);
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

document.addEventListener("DOMContentLoaded", () => Site.init());
