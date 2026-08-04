import { readFile, writeFile } from "node:fs/promises";

const files = ["charts-main.json", "charts-ost.json", "charts-classics.json", "charts-rnb.json"];
const appDir = new URL("../app/", import.meta.url);
const documents = await Promise.all(files.map(async (file) => ({
  file,
  url: new URL(file, appDir),
  data: JSON.parse(await readFile(new URL(file, appDir), "utf8")),
})));

const songs = documents.flatMap(({ data }) => data.charts.flatMap((chart) => chart.songs));
const videoIds = [...new Set(songs.map((song) => song.videoId).filter(Boolean))];
const viewCounts = new Map();
let cursor = 0;

async function fetchPublicViews(videoId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const endpoint = new URL("https://returnyoutubedislikeapi.com/votes");
      endpoint.searchParams.set("videoId", videoId);
      const response = await fetch(endpoint, {
        headers: { accept: "application/json", "user-agent": "Pulse-Charts-Weekly-Refresh/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const count = Number((await response.json()).viewCount);
        if (Number.isSafeInteger(count) && count >= 0) return count;
      }
    } catch {
      // Retry transient network and timeout failures.
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  return null;
}

async function worker() {
  while (cursor < videoIds.length) {
    const videoId = videoIds[cursor++];
    const count = await fetchPublicViews(videoId);
    if (count !== null) viewCounts.set(videoId, count);
  }
}

await Promise.all(Array.from({ length: 12 }, () => worker()));

if (viewCounts.size < Math.max(1, Math.floor(videoIds.length * 0.8))) {
  throw new Error(`YouTube returned only ${viewCounts.size}/${videoIds.length} video statistics; keeping the previous dataset.`);
}

const refreshedAt = new Date().toISOString();
let changed = 0;

function updateGenre(song, count) {
  if (typeof song.genre !== "string" || !/YouTube views$/i.test(song.genre)) return;
  song.genre = song.genre.replace(/[0-9][0-9,]* YouTube views$/i, `${count.toLocaleString("en-US")} YouTube views`);
}

for (const { data } of documents) {
  data.generatedAt = refreshedAt;
  for (const chart of data.charts) {
    for (const song of chart.songs) {
      const nextCount = viewCounts.get(song.videoId);
      if (nextCount === undefined) continue;
      if (song.viewCount !== nextCount) changed += 1;
      song.viewCount = nextCount;
      updateGenre(song, nextCount);
    }
    if (chart.id.includes("evergreen")) {
      chart.songs.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
      chart.songs.forEach((song, index) => { song.rank = index + 1; });
      chart.updatedAt = refreshedAt;
    }
  }
}

for (const { url, data } of documents) {
  await writeFile(url, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

console.log(`Refreshed ${viewCounts.size} YouTube videos; ${changed} view counts changed.`);
