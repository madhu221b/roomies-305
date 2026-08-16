import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(projectRoot, "playlist.config.json");
const outputPath = resolve(projectRoot, "public/playlist.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

if (!config.url) throw new Error("playlist.config.json must contain a YouTube or YouTube Music playlist URL.");

const configuredUrl = new URL(config.url);
const playlistId = configuredUrl.searchParams.get("list");
if (!playlistId) throw new Error("The configured playlist URL does not contain a list parameter.");

let rawPlaylist;
try {
  rawPlaylist = execFileSync("yt-dlp", ["--flat-playlist", "--dump-single-json", config.url], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"]
  });
} catch {
  throw new Error("Could not sync the playlist. Install yt-dlp and make sure the playlist is public or unlisted.");
}

const playlist = JSON.parse(rawPlaylist);
const tracks = (playlist.entries || []).filter(entry => entry?.id).map(entry => ({
  id: entry.id,
  title: entry.title || "Untitled track",
  artist: "YouTube Music",
  art: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`
}));

for (let offset = 0; offset < tracks.length; offset += 6) {
  const batch = tracks.slice(offset, offset + 6);
  await Promise.allSettled(batch.map(async track => {
    const videoUrl = `https://www.youtube.com/watch?v=${track.id}`;
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(videoUrl)}`;
    const response = await fetch(endpoint);
    if (!response.ok) return;
    const metadata = await response.json();
    if (metadata.title) track.title = metadata.title;
    if (metadata.author_name) track.artist = metadata.author_name;
    if (metadata.thumbnail_url) track.art = metadata.thumbnail_url;
  }));
}

const snapshot = {
  playlistId,
  playlistUrl: config.url,
  title: playlist.title || "Roomies Radio",
  syncedAt: new Date().toISOString(),
  tracks
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Synced ${tracks.length} tracks from “${snapshot.title}”.`);
