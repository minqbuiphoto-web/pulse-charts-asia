import { mkdir, readFile, writeFile } from "node:fs/promises";

const appDir = new URL("../app/", import.meta.url);
const main = JSON.parse(await readFile(new URL("charts-main.json", appDir), "utf8"));
const secondary = JSON.parse(await readFile(new URL("charts-ost.json", appDir), "utf8"));
const classics = JSON.parse(await readFile(new URL("charts-classics.json", appDir), "utf8"));
const rnb = JSON.parse(await readFile(new URL("charts-rnb.json", appDir), "utf8"));
const data = { generatedAt: main.generatedAt, charts: [...main.charts, ...secondary.charts, ...classics.charts, ...rnb.charts] };
const expectedIds = new Set([
  "kr-circle-digital", "kr-circle-download", "kr-ost-trending", "kr-ballad-trending",
  "jp-hot100", "cn-tme-uni", "cn-tme-wave", "cn-ost-trending", "cn-ballad-trending",
  "kr-ballad-evergreen-2016-2026", "kr-ballad-evergreen-2006-2015",
  "cn-ballad-evergreen-2016-2026", "cn-ballad-evergreen-2006-2015",
  "kr-ballad-evergreen-1996-2005", "cn-ballad-evergreen-1996-2005",
  "kr-rnb-evergreen-2016-2026", "kr-rnb-evergreen-2006-2015",
  "cn-rnb-evergreen-2016-2026", "cn-rnb-evergreen-2006-2015",
]);

if (data.charts.length !== expectedIds.size) throw new Error("Pulse Charts requires exactly nineteen charts.");
for (const chart of data.charts) {
  if (!expectedIds.has(chart.id)) throw new Error(`Unexpected chart: ${chart.id}`);
  if (!chart.sourceUrl || !chart.updatedAt) throw new Error(`Missing source metadata: ${chart.label}`);
  const expectedRows = chart.id.includes("evergreen") ? 50 : 20;
  if (!Array.isArray(chart.songs) || chart.songs.length !== expectedRows) throw new Error(`${chart.label} must contain ${expectedRows} rows.`);
  if (chart.id.includes("evergreen")) {
    if (chart.songs.some((song) => !song.videoId || !Number.isFinite(song.viewCount) || song.viewCount < 0)) throw new Error(`Missing measured views in ${chart.label}.`);
    if (chart.songs.some((song, index) => index > 0 && chart.songs[index - 1].viewCount < song.viewCount)) throw new Error(`Evergreen chart is not sorted by views: ${chart.label}.`);
    if (new Set(chart.songs.map((song) => song.videoId)).size !== chart.songs.length) throw new Error(`Duplicate measured video in ${chart.label}.`);
    if (!chart.syncWarning?.includes("strictly")) throw new Error(`Missing strict-ranking policy: ${chart.label}.`);
  }
  if (chart.id.includes("trending") && !chart.syncWarning?.includes("RECENCY RULE") && !chart.syncWarning?.includes("BALLAD-ONLY RULE")) throw new Error(`Missing curation policy: ${chart.label}`);
  if (chart.id.includes("trending") && chart.songs.some((song) => song.releaseDate === chart.market)) throw new Error(`Missing release window: ${chart.label}`);
  if (chart.id.includes("ballad") && chart.songs.some((song) => !song.genre.toLocaleLowerCase("en").includes("ballad"))) throw new Error(`Non-ballad row in ${chart.label}.`);
  if (chart.id.includes("rnb") && (!chart.syncWarning?.includes("NO RAP RULE") || chart.songs.some((song) => !song.genre.toLocaleLowerCase("en").includes("r&b") || /\brap\b/i.test(song.genre)))) throw new Error(`Non-vocal-R&B row in ${chart.label}.`);
  if (chart.id === "kr-ballad-trending") {
    const cutoff = new Date(data.generatedAt);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
    if (chart.songs.some((song) => !/^\d{4}-\d{2}-\d{2}$/.test(song.releaseDate) || new Date(`${song.releaseDate}T00:00:00Z`) < cutoff)) {
      throw new Error(`${chart.label} contains a release older than six months.`);
    }
  }
  if (chart.id.includes("evergreen-2016-2026") && chart.songs.some((song) => Number(song.releaseDate) < 2016 || Number(song.releaseDate) > 2026)) throw new Error("Wrong 0–10 year era in " + chart.label + ".");
  if (chart.id.includes("evergreen-2006-2015") && chart.songs.some((song) => Number(song.releaseDate) < 2006 || Number(song.releaseDate) > 2015)) throw new Error("Wrong 10–20 year era in " + chart.label + ".");
  chart.songs.forEach((song, index) => {
    if (song.rank !== index + 1 || !song.title || !song.artist) throw new Error(`Invalid ranking row in ${chart.label}.`);
  });
}
const publicDir = new URL("../public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL("charts.json", publicDir), JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Verified and exported 19 charts / 680 ranked tracks.");
