import { mkdir, readFile, writeFile } from "node:fs/promises";

const appDir = new URL("../app/", import.meta.url);
const main = JSON.parse(await readFile(new URL("charts-main.json", appDir), "utf8"));
const secondary = JSON.parse(await readFile(new URL("charts-ost.json", appDir), "utf8"));
const data = { generatedAt: main.generatedAt, charts: [...main.charts, ...secondary.charts] };
const expectedIds = new Set([
  "kr-circle-digital", "kr-circle-next", "kr-circle-download",
  "jp-hot100", "jp-hot100-next", "cn-tme-uni", "cn-tme-wave",
]);

if (data.charts.length !== expectedIds.size) throw new Error("Pulse Charts requires exactly seven charts.");
for (const chart of data.charts) {
  if (!expectedIds.has(chart.id)) throw new Error(`Unexpected chart: ${chart.id}`);
  if (!chart.sourceUrl || !chart.updatedAt) throw new Error(`Missing source metadata: ${chart.label}`);
  if (!Array.isArray(chart.songs) || chart.songs.length !== 10) throw new Error(`${chart.label} must contain 10 rows.`);
  chart.songs.forEach((song, index) => {
    if (song.rank !== index + 1 || !song.title || !song.artist) throw new Error(`Invalid ranking row in ${chart.label}.`);
  });
}
const publicDir = new URL("../public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL("charts.json", publicDir), JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Verified and exported 7 current charts / 70 ranked tracks.");
