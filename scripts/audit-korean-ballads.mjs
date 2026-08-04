import fs from "node:fs";

const data = JSON.parse(fs.readFileSync(new URL("../app/charts-classics.json", import.meta.url), "utf8"));
const charts = data.charts.filter((chart) => chart.id.startsWith("kr-ballad-evergreen-"));
const songs = charts.flatMap((chart) => chart.songs.map((song) => ({ chartId: chart.id, ...song })));
const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) throw new Error("YOUTUBE_API_KEY is required.");
const clientVersion = "2.20260731.00.00";

function walk(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (value.videoRenderer) output.push(value.videoRenderer);
  for (const child of Object.values(value)) walk(child, output);
  return output;
}

function text(runs) {
  return runs?.map((item) => item.text).join("") ?? "";
}

function views(value) {
  const match = String(value ?? "").replaceAll(",", "").match(/([0-9]+)/);
  return match ? Number(match[1]) : 0;
}

async function search(song) {
  const query = `${song.artist} ${song.title}`;
  const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
      query,
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${query}`);
  const seen = new Set();
  return walk(await response.json()).flatMap((video) => {
    if (!video.videoId || seen.has(video.videoId)) return [];
    seen.add(video.videoId);
    return [{
      videoId: video.videoId,
      title: text(video.title?.runs),
      channel: text(video.ownerText?.runs),
      views: views(video.viewCountText?.simpleText),
    }];
  });
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < songs.length) {
    const song = songs[cursor++];
    try {
      const candidates = await search(song);
      results.push({
        chartId: song.chartId,
        song: { title: song.title, artist: song.artist, videoId: song.videoId, views: song.viewCount },
        candidates: candidates.filter((candidate) => candidate.views > song.viewCount * 1.05).slice(0, 12),
      });
      console.error(`${cursor}/${songs.length} ${song.artist} — ${song.title}`);
    } catch (error) {
      console.error(`FAILED ${song.artist} — ${song.title}: ${error}`);
    }
  }
}

await Promise.all(Array.from({ length: 6 }, () => worker()));
fs.writeFileSync(new URL("../.audit-korean-ballads.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(`Wrote ${results.length} audited songs.`);
