# Federico Coscia — Portfolio

Personal photography & filmmaking website. Plain HTML/CSS/JS, no build step, no framework.

## Structure

```
/                     Pages (index.html, about/, photos/, videos/, contact/)
header.html           Shared nav, injected into every page by script.js
styles.css            All styles
script.js             All behavior (data fetching, rendering, interactions)
data/*.json           Site content - edit these, not the HTML, to update text/photos/videos
_resources/           Source images/videos (gitignored) + generated *-web/ versions used by the site
scripts/              Maintenance scripts (image/video conversion, YouTube playlist fetch, EXIF metadata)
```

## Running locally

No build/install needed - just serve the folder statically, e.g.:

```
npx serve .
```

## Updating content

- Photos/videos/site text: edit the matching file in `data/`.
- New photos/videos: add originals to `_resources/images` or `_resources/videos`, then run the matching script in `scripts/` to generate the compressed web versions.
- YouTube playlists (`data/youtube-playlists.json`): regenerate with `python scripts/fetch_youtube_playlists.py` (needs a `.env` with `YOUTUBE_API_KEY` - see `.env.example`).

## License

MIT
