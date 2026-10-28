import { onPage, prefersReducedMotion } from "./utils.js";
import { fillParallaxStack } from "./parallax-bg.js";
import { initLoopRows } from "./loop-rows.js";

onPage(".channel-playlists", (_, signal) => {
  initBackgroundVideos(signal);
  initFeaturedFacade();
  initDescriptionToggle(signal);
  initLoopRows(signal);
  initVideoModal();
});

// ── Background clips ──
// Each clip only plays while on screen. The header's pause button (hidden on
// every other page) stops them all; reduced-motion visitors start paused.
function initBackgroundVideos(signal) {
  const stack = document.getElementById("video-bg-stack");
  const toggle = document.getElementById("bg-toggle");
  if (!stack || !toggle) return;

  const originals = [...stack.querySelectorAll("video")];
  const visible = new Set();
  let paused = prefersReducedMotion();

  const sync = () =>
    [...stack.children].forEach((video) => (!paused && visible.has(video) ? video.play().catch(() => {}) : video.pause()));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => (isIntersecting ? visible.add(target) : visible.delete(target)));
    sync();
  });

  const track = (video) => {
    // play() is rejected while nothing is buffered yet; retry once data arrives.
    video.addEventListener("canplay", sync, { signal });
    observer.observe(video);
  };

  // ClientRouter can reuse a <video> element across navigations, and a reused
  // element doesn't reliably restart - an explicit load() resets it.
  originals.forEach((video) => {
    video.load();
    track(video);
  });

  // Clips are repeated to fill the background; only the ones on screen play.
  fillParallaxStack(stack, signal, {
    onAdd: (clone) => {
      clone.muted = true;
      track(clone);
    },
    onRemove: (clip) => {
      observer.unobserve(clip);
      visible.delete(clip);
    },
  });
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

// ── Featured description ──
// On mobile the CSS clamps the description to 3 lines; the toggle only shows
// when that actually hides text. Rechecked on resize, since the clamp is
// breakpoint-dependent.
function initDescriptionToggle(signal) {
  const description = document.getElementById("video-featured-description");
  const toggle = document.getElementById("video-description-toggle");
  if (!description || !toggle) return;

  const update = () => {
    if (!description.classList.contains("is-expanded")) toggle.hidden = description.scrollHeight <= description.clientHeight;
  };
  const observer = new ResizeObserver(update);
  observer.observe(description);
  signal.addEventListener("abort", () => observer.disconnect());

  toggle.addEventListener(
    "click",
    () => {
      const expanded = description.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "Show less" : "Show more";
    },
    { signal },
  );
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
