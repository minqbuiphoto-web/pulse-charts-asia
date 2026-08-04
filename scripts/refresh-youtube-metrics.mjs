import { readFile, writeFile } from "node:fs/promises";

const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) throw new Error("YOUTUBE_API_KEY is required for the weekly refresh.");

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

for (let index = 0; index < videoIds.length; index += 50) {
  const ids = videoIds.slice(index, index + 50);
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "statistics");
  endpoint.searchParams.set("id", ids.join(","));
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`YouTube API returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  for (const item of payload.items ?? []) {
    const count = Number(item.statistics?.viewCount);
    if (Number.isSafeInteger(count) && count >= 0) viewCounts.set(item.id, count);
  }
}

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
