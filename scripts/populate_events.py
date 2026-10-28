#!/usr/bin/env python3
"""
Rebuilds the "photos" list of every event in src/data/events.json from the
originals in assets-source/images/events/<folder>, in a shuffled order that
is the same on every run. Everything else in the file (titles, CV text,
places, row order, background) is kept.

Run after adding photos to an event folder:
    python scripts/populate_events.py
"""

import json
import random
from pathlib import Path

from PIL import Image

from populate_metadata import ORIGINAL_EXTENSIONS, REPO_ROOT, extract_metadata

JSON_PATH = REPO_ROOT / "src" / "data" / "events.json"
EVENTS_DIR = REPO_ROOT / "assets-source" / "images" / "events"
ORIENTATION_SWAPS = {5, 6, 7, 8}  # EXIF orientations rotated by 90 degrees


def read_photo(path):
    with Image.open(path) as img:
        exif = img.getexif()
        width, height = img.size
        if exif.get(274) in ORIENTATION_SWAPS:
            width, height = height, width  # the webp copy has the rotation baked in
    meta = extract_metadata(path)
    return {
        "src": path.relative_to(REPO_ROOT / "assets-source").as_posix(),
        "date": meta["date"],
        "camera": meta["camera"],
        "shutter": meta["shutter"],
        "aperture": meta["aperture"],
        "iso": meta["iso"],
        "width": width,
        "height": height,
    }


def main():
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    for event in data["events"]:
        files = sorted(f for f in (EVENTS_DIR / event["folder"]).iterdir() if f.suffix.lower() in ORIGINAL_EXTENSIONS)
        photos = [read_photo(f) for f in files]
        # Seeded by the event, so re-running only reshuffles when photos change.
        random.Random(event["slug"]).shuffle(photos)
        event["photos"] = photos
        print(f"{event['title']}: {len(photos)} photos")
    JSON_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
