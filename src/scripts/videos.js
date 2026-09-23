import { onPage, prefersReducedMotion } from "./utils.js";
import { LOOP_BUFFER_CARDS } from "../lib/constants.js";

onPage(".channel-playlists", (_, signal) => {
  initBackgroundVideos(signal);
  initFeaturedFacade();
  initPlaylistRows(signal);
  initVideoModal();
});

// ── Background clips ──
// Each clip only plays while on screen. The header's pause button (hidden on
// every other page) stops them all; reduced-motion visitors start paused.
function initBackgroundVideos(signal) {
  const stack = document.getElementById("video-bg-stack");
  const toggle = document.getElementById("bg-toggle");
  if (!stack || !toggle) return;

  const videos = [...stack.querySelectorAll("video")];
  const visible = new Set();
  let paused = prefersReducedMotion();

  // ClientRouter can reuse a <video> element across navigations, and a reused
  // element doesn't reliably restart - an explicit load() resets it.
  videos.forEach((video) => video.load());

  const sync = () =>
    videos.forEach((video) => (!paused && visible.has(video) ? video.play().catch(() => {}) : video.pause()));
  // play() is rejected while nothing is buffered yet; retry once data arrives.
  videos.forEach((video) => video.addEventListener("canplay", sync, { signal }));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => (isIntersecting ? visible.add(target) : visible.delete(target)));
    sync();
  });
  videos.forEach((video) => observer.observe(video));
  signal.addEventListener("abort", () => observer.disconnect());

  const render = () => {
    toggle.classList.toggle("is-paused", paused);
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute("aria-label", paused ? "Play background videos" : "Pause background videos");
  };
  toggle.hidden = false;
  render();
  toggle.addEventListener("click", () => {
    paused = !paused;
    render();
    sync();
  });
}

// ── Featured video facade ──
function initFeaturedFacade() {
  const facade = document.getElementById("video-facade");
  if (!facade) return;

  const img = facade.querySelector("img");
  // Not every video has a maxres thumbnail; YouTube answers with a 120px
  // placeholder instead of an error.
  const fallback = () => img.naturalWidth <= 120 && (img.src = img.src.replace("maxresdefault", "hqdefault"));
  if (img.complete) fallback();
  else img.addEventListener("load", fallback, { once: true });

  facade.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${facade.dataset.videoId}?rel=0&autoplay=1`;
    iframe.title = facade.getAttribute("aria-label").replace(/^Play /, "");
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    facade.replaceWith(iframe);
    iframe.focus();
  });
}

// ── Playlist rows ──
// Looped rows were rendered as [clone tail][real cards][clone head]. Clones
// mirror the real cards, so jumping scrollLeft by exactly one real-content
// width is invisible - the same fixed set of nodes scrolls forever.
//
// The jump only happens once scrolling has come to rest: moving scrollLeft
// mid-gesture cancels or stutters the browser's momentum ('throwing' the
// strip). At rest the strip is re-centred, leaving a full clone buffer of
// runway on both sides for the next throw; only a throw that nears the
// physical end of the strip triggers an immediate jump.
function initPlaylistRows(signal) {
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

// ── Video modal (YouTube IFrame Player API) ──
let youtubeApi; // loaded once per session, shared across visits

function loadYouTubeApi() {
  youtubeApi ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return youtubeApi;
}

function initVideoModal() {
  const modal = document.getElementById("video-modal");
  const title = document.getElementById("video-modal-title");
  let player = null;

  const close = () => modal.open && modal.close();
  document.getElementById("video-modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => e.target === modal && close());
  modal.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    player?.stopVideo?.();
  });

  document.querySelector(".channel-playlists").addEventListener("click", async (e) => {
    const card = e.target.closest(".playlist-card");
    if (!card) return;
    const { videoId, videoTitle } = card.dataset;

    title.textContent = videoTitle ?? "";
    document.body.classList.add("modal-open");
    if (!modal.open) modal.showModal();

    const YT = await loadYouTubeApi();
    if (player) player.loadVideoById(videoId);
    else player = new YT.Player("youtube-player", { videoId, host: "https://www.youtube-nocookie.com", playerVars: { rel: 0, playsinline: 1, autoplay: 1 } });
  });
}
