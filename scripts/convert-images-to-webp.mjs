// Converts every photo in assets-source/images to a resized .webp copy in
// _resources/images-web, keeping the same subfolders (2019/IMG_0082.jpg ->
// 2019/IMG_0082.webp). Upload that folder to the bucket's images-web/ prefix;
// the site serves these instead of the raw originals (15-50MB each), see
// webKey() in src/lib/photos.ts. Existing outputs are skipped.
//
// Usage: node scripts/convert-images-to-webp.mjs

import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "assets-source", "images");
const DEST_DIR = join(ROOT, "_resources", "images-web");
const MAX_DIM = 2048;
const QUALITY = 80;

const exists = (path) => stat(path).then(() => true, () => false);

let converted = 0;
let skipped = 0;
for (const entry of await readdir(SRC_DIR, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(jpe?g|png)$/i.test(entry.name)) continue;
  const src = join(entry.parentPath, entry.name);
  const out = join(DEST_DIR, relative(SRC_DIR, src)).replace(/\.\w+$/, ".webp");
  if (await exists(out)) {
    skipped++;
    continue;
  }
  await mkdir(dirname(out), { recursive: true });
  // rotate() bakes in the EXIF orientation, since the webp carries no metadata.
  await sharp(src).rotate().resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(out);
  console.log(`Converted: ${relative(SRC_DIR, src)}`);
  converted++;
}

console.log(`Done. Converted: ${converted}, already existed: ${skipped}, output: ${DEST_DIR}`);
