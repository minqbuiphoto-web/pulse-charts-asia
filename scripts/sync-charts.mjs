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
const rejectedVideoMatches = new Set([
  // When in Rome - "The Promise" (1988), incorrectly matched to Korean artist Position.
  "5HI_xFQWiYU",
  // Low-view KBS stage previously selected instead of the highest-view verified original-artist performance.
  "oOT1nh-eiyY",
]);

if (data.charts.length !== expectedIds.size) throw new Error("Pulse Charts requires exactly nineteen charts.");
for (const chart of data.charts) {
  if (!expectedIds.has(chart.id)) throw new Error(`Unexpected chart: ${chart.id}`);
  if (!chart.sourceUrl || !chart.updatedAt) throw new Error(`Missing source metadata: ${chart.label}`);
  const expectedRows = 50;
  if (!Array.isArray(chart.songs) || chart.songs.length !== expectedRows) throw new Error(`${chart.label} must contain ${expectedRows} rows.`);
  if (chart.id.includes("evergreen")) {
    if (chart.songs.some((song) => !song.videoId || !Number.isFinite(song.viewCount) || song.viewCount < 0)) throw new Error(`Missing measured views in ${chart.label}.`);
    if (chart.songs.some((song, index) => index > 0 && chart.songs[index - 1].viewCount < song.viewCount)) throw new Error(`Evergreen chart is not sorted by views: ${chart.label}.`);
    if (new Set(chart.songs.map((song) => song.videoId)).size !== chart.songs.length) throw new Error(`Duplicate measured video in ${chart.label}.`);
    if (chart.songs.some((song) => rejectedVideoMatches.has(song.videoId))) throw new Error("Rejected YouTube title/artist mismatch in " + chart.label + ".");
    if (!chart.syncWarning?.includes("strictly")) throw new Error(`Missing strict-ranking policy: ${chart.label}.`);
  }
  if (chart.id.includes("trending") && !chart.syncWarning?.includes("RECENCY RULE") && !chart.syncWarning?.includes("BALLAD-ONLY RULE")) throw new Error(`Missing curation policy: ${chart.label}`);
  if (chart.id.includes("ost-trending") && (!chart.syncWarning?.includes("ALBUM GROUPING RULE") || !chart.syncWarning?.includes("FIVE-TRACK OST RULE") || chart.songs.some((song) => !song.filmTitle || !song.album))) throw new Error(`Missing OST album metadata: ${chart.label}`);
  if (chart.id.includes("ost-trending")) {
    const groups = new Map();
    for (const song of chart.songs) { const key = song.album ?? song.filmTitle; groups.set(key, [...(groups.get(key) ?? []), song]); }
    for (const group of groups.values()) {
      const root = group[0];
      const playable = [...group, ...(root.albumTracks ?? [])].filter((song) => /^[A-Za-z0-9_-]{11}$/.test(song.videoId ?? "") && Number(song.durationSeconds) >= 120 && Number(song.durationSeconds) <= 900);
      const uniqueCount = new Set(playable.map((song) => song.videoId)).size;
      if (uniqueCount > 5) throw new Error(`${chart.label} allows at most five distinct published full-length videos for ${root.filmTitle}.`);
    }
  }
  if (chart.id === "cn-ost-trending" && (chart.songs.some((song) => song.filmTitle.includes("Screen OST")) || new Set(chart.songs.map((song) => song.filmTitle)).size !== 50 || !chart.syncWarning?.includes("TOP 50 FILMS RULE"))) throw new Error("China OST must contain fifty unique verified film albums.");
  if (chart.id.includes("trending") && chart.songs.some((song) => song.releaseDate === chart.market)) throw new Error(`Missing release window: ${chart.label}`);
  if (chart.id.includes("ballad") && chart.songs.some((song) => !song.genre.toLocaleLowerCase("en").includes("ballad"))) throw new Error(`Non-ballad row in ${chart.label}.`);
  if (chart.id.includes("rnb") && (!chart.syncWarning?.includes("SONG-LEVEL GENRE RULE") || !chart.syncWarning?.includes("NO RAP RULE") || chart.songs.some((song) => song.style !== "Vocal R&B / Soul" || song.genreBasis !== "song-level" || song.genreReviewed !== true || /\brap\b/i.test(song.genre)))) throw new Error(`Unreviewed or non-vocal-R&B row in ${chart.label}.`);
  if (chart.id === "kr-ballad-trending") {
    const cutoff = new Date(data.generatedAt);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
    if (chart.songs.slice(0, 20).some((song) => !/^\d{4}-\d{2}-\d{2}$/.test(song.releaseDate) || new Date(`${song.releaseDate}T00:00:00Z`) < cutoff)) {
      throw new Error(`${chart.label} contains a release older than six months.`);
    }
  }
  if (chart.id.includes("evergreen-2016-2026") && chart.songs.some((song) => Number(song.releaseDate) < 2016 || Number(song.releaseDate) > 2026)) throw new Error("Wrong 0–10 year era in " + chart.label + ".");
  if (chart.id.includes("evergreen-2006-2015") && chart.songs.some((song) => Number(song.releaseDate) < 2006 || Number(song.releaseDate) > 2015)) throw new Error("Wrong 10–20 year era in " + chart.label + ".");
  chart.songs.forEach((song, index) => {
    if (song.rank !== index + 1 || !song.title || !song.artist) throw new Error(`Invalid ranking row in ${chart.label}.`);
  });
}
const likeIt = data.charts.find((chart) => chart.id === "kr-ballad-evergreen-2016-2026")?.songs.find((song) => song.title === "Like It" && song.artist === "Yoon Jong Shin");
if (!likeIt || likeIt.videoId !== "jy_UiIQn_d0" || likeIt.videoType !== "official-live" || likeIt.viewCount < 42_000_000) throw new Error("Like It must use the highest-view verified original-artist performance.");

const rnbRows = data.charts.filter((chart) => chart.id.includes("rnb")).flatMap((chart) => chart.songs);
if (rnbRows.some((song) => song.title === "Beautiful" && song.artist === "Crush")) throw new Error("Beautiful by Crush is a ballad/OST recording, not an R&B chart entry.");

const publicDir = new URL("../public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL("charts.json", publicDir), JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Verified and exported 19 charts / 950 ranked tracks.");
