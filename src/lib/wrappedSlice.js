// Returns `length` items from `list`, starting at `start` (which may be
// negative or beyond list.length) and wrapping around as many times as
// needed. Used at build time to construct the clone buffers around each
// looped playlist row (see src/pages/videos/index.astro).
export function wrappedSlice(list, start, length) {
  const n = list.length;
  const out = [];
  for (let i = 0; i < length; i++) {
    out.push(list[(((start + i) % n) + n) % n]);
  }
  return out;
}
