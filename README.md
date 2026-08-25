# Federico Coscia — Portfolio

Personal photography & filmmaking website. Built with [Astro](https://astro.build) - static output, no client-side framework.

## Structure

```
src/pages/            Routes (index.astro, about/, photos/, videos/, contact/)
src/layouts/          Layout.astro - shared <head>, <Header/>, footer
src/components/       Header.astro, PlaylistCard.astro
src/data/*.json       Site content - edit these, not the pages, to update text/photos/videos
src/scripts/site.js   All client-side behavior (interactions only - content is rendered by Astro)
src/styles/global.css All styles
src/lib/              Small build-time helpers shared between pages and site.js
public/_resources/    Web-ready images/videos, served as-is (logos, *-web/ generated assets)
assets-source/        Raw photo/video originals (gitignored, NOT served) - input to the conversion scripts
scripts/              Maintenance scripts (image/video conversion, YouTube playlist fetch, EXIF metadata)
```

## Running locally

```
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Updating content

- Photos/videos/site text: edit the matching file in `src/data/`.
- New photos/videos: add originals to `assets-source/images` or `assets-source/videos`, then run the matching script in `scripts/` to generate the compressed web versions into `public/_resources/`.
- YouTube playlists (`src/data/youtube-playlists.json`): regenerate with `python scripts/fetch_youtube_playlists.py` (needs a `.env` with `YOUTUBE_API_KEY` - see `.env.example`).

Content in `src/data/*.json` is loaded at **build time** (imported directly into pages), not fetched by the browser - after editing a JSON file you need to re-run `npm run dev`/`npm run build` to see the change.

## License

MIT
