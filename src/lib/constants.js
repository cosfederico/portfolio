// Shared between build-time templating (src/pages/videos/index.astro, which
// builds the clone buffers) and client runtime (src/scripts/site.js, which
// jumps scrollLeft by this many cards' width) - both sides MUST agree on
// this number or the infinite-loop math breaks, so it lives in one place
// instead of two copies that could drift out of sync.
export const LOOP_BUFFER_CARDS = 14;
