# Federico Coscia — Portfolio

Personal photography & filmmaking website at [federicocoscia.photos](https://federicocoscia.photos). Built with [Astro 7](https://astro.build), no client-side framework. Every page is prerendered at build time except `src/pages/api/contact.ts` (`export const prerender = false`), which runs on demand in a Cloudflare Worker via `@astrojs/cloudflare`.

## Structure

```
src/pages/            Routes (index, about/, photos/, videos/, contact/, 404, api/contact)
src/layouts/          Layout.astro - <head> (SEO, Open Graph, JSON-LD, fonts), header, footer
src/components/       Header.astro, PlaylistCard.astro
src/data/*.json       Site content - edit these, not the pages, to update text/photos/videos
src/scripts/          Client-side behaviour, one module per page/feature (home, photos, videos, contact, header, reveal)
src/styles/global.css Tokens, base styles and shared components; page styles live in each .astro file
src/lib/              Build-time helpers (photo pipeline, formatting, contact validation + its tests)
src/_resources/       Photos (images-web/) - gitignored, optimized by Astro at build time
public/_resources/    Served as-is: background videos (videos-web/), film strip
assets-source/        Raw photo/video originals (gitignored, NOT served) - input to the conversion scripts
scripts/              Maintenance scripts (image/video conversion, YouTube playlist fetch, EXIF metadata)
```

## Running locally

Requires Node 22.12+.

```
npm install
npm run dev       # http://localhost:4321 (runs in the workerd runtime)
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
npm run check     # type-check .astro/.ts files
npm test          # unit tests (node:test)
```

## Updating content

- **Photos:** every photo and its metadata (camera, exposure, date, place, story) lives in `src/data/mosaic-items.json`; the home mosaic shows all of them. The Photography page groups them into collections in `src/data/photos.json`:

  ```json
  { "collections": [{ "slug": "2025", "title": "2025", "description": "…", "images": ["img-149", "img-150"] }] }
  ```

  `images` are ids from `mosaic-items.json`. The current collections are a first pass grouped by year - rename, regroup and rewrite the descriptions freely.
- **New photos:** add originals to `assets-source/images`, run `scripts/convert-images-to-webp.bat` (writes to `src/_resources/images-web/`), add an entry to `mosaic-items.json`, then `python scripts/populate_metadata.py` to fill EXIF fields. Astro generates the thumbnail/lightbox sizes at build time (`src/lib/photos.ts`).
- **New videos:** `scripts/convert-videos-to-web.bat`, then list them in `src/data/background-videos.json`.
- **YouTube playlists** (`src/data/youtube-playlists.json`): regenerate with `python scripts/fetch_youtube_playlists.py` (needs a `.env` with `YOUTUBE_API_KEY` - see `.env.example`).
- **Name, email, location, social links:** `src/data/site.json` (used by the header, footer, contact page, structured data and the contact endpoint).

Content in `src/data/*.json` is loaded at **build time**, so re-run `npm run dev`/`npm run build` after editing.

## Contact form email

`src/pages/api/contact.ts` validates input with `src/lib/contact.ts` (length limits, control-character stripping, a honeypot field) and sends inquiries via the [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). It needs `CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN` and `CF_EMAIL_FROM` at runtime - see `.dev.vars.example` for local setup (copy to `.dev.vars`) and the one-time Cloudflare dashboard steps. In production, set the same three as secrets on the Worker.

## Deployment

`npm run build` produces a Cloudflare Worker (`dist/server`, with a generated `wrangler.json`) plus static assets (`dist/client`). Deploy with `npx wrangler deploy`. Note: `@astrojs/cloudflare` v13+ targets **Workers**, not Pages.

Photos (`src/_resources/`) and videos (`public/_resources/`) are gitignored, so a build from a fresh git clone (e.g. Cloudflare's Git integration) won't have them - build locally, or move the media to R2 first.

## License

MIT
