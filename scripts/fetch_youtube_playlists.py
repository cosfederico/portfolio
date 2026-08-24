#!/usr/bin/env python3
"""
Fetches this channel's public playlists (and the videos inside each one) from
the YouTube Data API v3 and writes the normalized result to
data/youtube-playlists.json - the same static-JSON pattern the site already
uses for photos.json / videos.json / mosaic-items.json.

This script runs OUTSIDE the browser (on your machine, or later from a
scheduled CI job) so the API key never ships to visitors. The site itself
only ever fetches the plain JSON this script produces - see
scripts/README.md for the full explanation of why the key lives here and
not in script.js.

Setup:
  1. Copy .env.example to .env and fill in YOUTUBE_API_KEY (see that file
     for how to create one).
  2. Load .env into your shell, e.g.:
       PowerShell:  Get-Content .env | ForEach-Object {
                       if ($_ -match '^\\s*([^#=]+)=(.*)$') {
                         [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
                       }
                     }
       bash/WSL:    set -a; source .env; set +a
  3. Run: python scripts/fetch_youtube_playlists.py

Environment variables:
  YOUTUBE_API_KEY         required. Your API key with YouTube Data API v3 enabled.
  YOUTUBE_CHANNEL_HANDLE  optional, default "@pikasfed" (see data/site.json).
  YOUTUBE_CHANNEL_ID      optional. Skips the handle lookup if already known.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "youtube-playlists.json"
API_BASE = "https://www.googleapis.com/youtube/v3"

DEFAULT_HANDLE = "@pikasfed"
MAX_PLAYLIST_PAGES = 20          # 50 playlists/page -> up to 1000 playlists
MAX_VIDEOS_PER_PLAYLIST = 200    # safety cap so one giant playlist can't run away


def api_get(endpoint, params):
    url = f"{API_BASE}/{endpoint}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"YouTube API error ({exc.code}) calling {endpoint}: {body}", file=sys.stderr)
        raise


def resolve_channel_id(api_key, handle, explicit_channel_id):
    if explicit_channel_id:
        return explicit_channel_id

    data = api_get("channels", {"part": "id", "forHandle": handle, "key": api_key})
    items = data.get("items", [])
    if not items:
        raise SystemExit(f"Could not resolve a channel id for handle '{handle}'.")
    return items[0]["id"]


def fetch_all_playlists(api_key, channel_id):
    playlists = []
    page_token = None

    for _ in range(MAX_PLAYLIST_PAGES):
        params = {
            "part": "snippet,contentDetails",
            "channelId": channel_id,
            "maxResults": 50,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token

        data = api_get("playlists", params)
        playlists.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return playlists


def fetch_playlist_videos(api_key, playlist_id):
    videos = []
    page_token = None

    while len(videos) < MAX_VIDEOS_PER_PLAYLIST:
        params = {
            "part": "snippet",
            "playlistId": playlist_id,
            "maxResults": 50,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token

        data = api_get("playlistItems", params)

        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            video_id = snippet.get("resourceId", {}).get("videoId")
            title = snippet.get("title", "")
            thumbnails = snippet.get("thumbnails") or {}

            # Deleted/private videos stay in the playlist as placeholder items
            # with no real thumbnail - skip them so rows don't show blanks.
            if not video_id or title in ("Private video", "Deleted video") or not thumbnails:
                continue

            # "medium" (320x180) and "maxres" (1280x720) are true 16:9 crops;
            # "high"/"default"/"standard" are 4:3 with black pillarbox bars
            # baked into the actual pixels for widescreen videos, which is
            # why cards looked letterboxed before this fix - prefer maxres
            # when the uploader provided one, else fall back to medium
            # (always available), only touching high/default as a last resort.
            thumb = (
                thumbnails.get("maxres")
                or thumbnails.get("medium")
                or thumbnails.get("high")
                or thumbnails.get("default")
                or {}
            )
            videos.append({
                "id": video_id,
                "title": title,
                "thumbnail": thumb.get("url", ""),
            })

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return videos[:MAX_VIDEOS_PER_PLAYLIST]


def main():
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise SystemExit("Set YOUTUBE_API_KEY in your environment before running this (see .env.example).")

    handle = os.environ.get("YOUTUBE_CHANNEL_HANDLE", DEFAULT_HANDLE)
    explicit_channel_id = os.environ.get("YOUTUBE_CHANNEL_ID")

    channel_id = resolve_channel_id(api_key, handle, explicit_channel_id)
    print(f"Channel: {handle} ({channel_id})")

    raw_playlists = fetch_all_playlists(api_key, channel_id)
    print(f"Found {len(raw_playlists)} playlists")

    playlists = []
    for playlist in raw_playlists:
        videos = fetch_playlist_videos(api_key, playlist["id"])
        if not videos:
            continue  # skip empty/fully-private playlists - no point in an empty row

        playlists.append({
            "id": playlist["id"],
            "title": playlist["snippet"]["title"],
            "description": playlist["snippet"].get("description", ""),
            "videos": videos,
        })
        print(f"  - {playlist['snippet']['title']}: {len(videos)} videos")

    output = {
        "channel": {"id": channel_id, "handle": handle},
        "playlists": playlists,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {len(playlists)} playlists to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    print("Commit this file - the static site serves it as-is, the same way it serves videos.json.")


if __name__ == "__main__":
    main()
