import { readFile } from "node:fs/promises";

const outputUrl = new URL("../public/charts.json", import.meta.url);
const data = JSON.parse(await readFile(outputUrl, "utf8"));
const expectedIds = new Set(["kr-pop", "kr-ballad", "jp-billboard", "cn-qq", "kr-ost", "jp-ost", "cn-ost"]);

if (!Array.isArray(data.charts) || data.charts.length !== expectedIds.size) {
  throw new Error("Pulse Charts requires exactly seven charts.");
}
for (const chart of data.charts) {
  if (!expectedIds.has(chart.id)) {
    throw new Error(`Unexpected chart: ${chart.id}`);
  }
  if (!Array.isArray(chart.songs) || chart.songs.length !== 10) {
    throw new Error(`${chart.label} must contain a verified Top 10 snapshot.`);
  }
  chart.songs.forEach((song, index) => {
    if (song.rank !== index + 1 || !song.title || !song.artist) {
      throw new Error(`Invalid ranking row in ${chart.label}.`);
    }
  });
}
console.log("Verified 7 charts / 70 ranked tracks.");