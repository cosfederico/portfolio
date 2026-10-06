// Fetches this channel's public playlists (and the videos inside each one) from
// the YouTube Data API v3 and writes the normalized result to
// src/data/youtube-playlists.json, which src/pages/videos/index.astro imports
// at build time. Runs at build time only, so the API key never ships to visitors.
//
// Run: node --env-file-if-exists=.env scripts/fetch-youtube-playlists.mjs
//
// Environment variables (see .env.example):
//   YOUTUBE_API_KEY         required. Without it the script skips the fetch.
//   YOUTUBE_CHANNEL_HANDLE  optional, default "@pikasfed" (see src/data/site.json).
//   YOUTUBE_CHANNEL_ID      optional. Skips the handle lookup if already known.
//
// Never fails the build: if the key is missing or the API errors, it warns and
// leaves the committed youtube-playlists.json untouched as the fallback.

import { writeFile } from "node:fs/promises";

const OUTPUT_URL = new URL("../src/data/youtube-playlists.json", import.meta.url);
const API_BASE = "https://www.googleapis.com/youtube/v3";

const DEFAULT_HANDLE = "@pikasfed";
const MAX_PLAYLIST_PAGES = 20; // 50 playlists/page -> up to 1000 playlists
const MAX_VIDEOS_PER_PLAYLIST = 200; // safety cap so one giant playlist can't run away

const apiKey = process.env.YOUTUBE_API_KEY;
const handle = process.env.YOUTUBE_CHANNEL_HANDLE || DEFAULT_HANDLE;

async function apiGet(endpoint, params) {
  const url = `${API_BASE}/${endpoint}?${new URLSearchParams({ ...params, key: apiKey })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API error (${res.status}) calling ${endpoint}: ${await res.text()}`);
  return res.json();
}

async function resolveChannelId() {
  if (process.env.YOUTUBE_CHANNEL_ID) return process.env.YOUTUBE_CHANNEL_ID;
  const data = await apiGet("channels", { part: "id", forHandle: handle });
  const id = data.items?.[0]?.id;
  if (!id) throw new Error(`Could not resolve a channel id for handle '${handle}'.`);
  return id;
}

async function fetchAllPlaylists(channelId) {
  const playlists = [];
  let pageToken;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
    const data = await apiGet("playlists", {
      part: "snippet,contentDetails",
      channelId,
      maxResults: 50,
      ...(pageToken && { pageToken }),
    });
    playlists.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return playlists;
}

async function fetchPlaylistVideos(playlistId) {
  const videos = [];
  let pageToken;
  while (videos.length < MAX_VIDEOS_PER_PLAYLIST) {
    const data = await apiGet("playlistItems", {
      part: "snippet",
      playlistId,
      maxResults: 50,
      ...(pageToken && { pageToken }),
    });

    for (const { snippet = {} } of data.items ?? []) {
      const videoId = snippet.resourceId?.videoId;
      const title = snippet.title ?? "";
      const thumbnails = snippet.thumbnails ?? {};

      // Deleted/private videos stay in the playlist as placeholder items
      // with no real thumbnail - skip them so rows don't show blanks.
      if (!videoId || title === "Private video" || title === "Deleted video" || !Object.keys(thumbnails).length) {
        continue;
      }

      // "maxres" (1280x720) and "medium" (320x180) are true 16:9 crops;
      // "high"/"default" are 4:3 with black pillarbox bars baked into the
      // pixels for widescreen videos, so they're only a last resort.
      const thumb = thumbnails.maxres ?? thumbnails.medium ?? thumbnails.high ?? thumbnails.default ?? {};
      videos.push({ id: videoId, title, thumbnail: thumb.url ?? "" });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return videos.slice(0, MAX_VIDEOS_PER_PLAYLIST);
}

async function main() {
  const channelId = await resolveChannelId();
  console.log(`Channel: ${handle} (${channelId})`);

  const rawPlaylists = await fetchAllPlaylists(channelId);
  console.log(`Found ${rawPlaylists.length} playlists`);

  const playlists = [];
  for (const playlist of rawPlaylists) {
    const videos = await fetchPlaylistVideos(playlist.id);
    if (!videos.length) continue; // skip empty/fully-private playlists - no point in an empty row

    playlists.push({
      id: playlist.id,
      title: playlist.snippet.title,
      description: playlist.snippet.description ?? "",
      videos,
    });
    console.log(`  - ${playlist.snippet.title}: ${videos.length} videos`);
  }

  const output = { channel: { id: channelId, handle }, playlists };
  await writeFile(OUTPUT_URL, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${playlists.length} playlists to src/data/youtube-playlists.json`);
}

if (!apiKey) {
  console.warn("[youtube] YOUTUBE_API_KEY not set - skipping fetch, using committed youtube-playlists.json.");
} else {
  await main().catch((err) => {
    console.warn(`[youtube] Fetch failed - using committed youtube-playlists.json.\n${err.message}`);
  });
}
