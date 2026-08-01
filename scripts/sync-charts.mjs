import { readFile } from "node:fs/promises";

const outputUrl = new URL("../public/charts.json", import.meta.url);
const data = JSON.parse(await readFile(outputUrl, "utf8"));
const expected = new Map([
  ["KR", "Circle Chart"],
  ["JP", "Billboard Japan"],
  ["CN", "Tencent Music"],
]);

if (!Array.isArray(data.charts) || data.charts.length !== expected.size) {
  throw new Error("Pulse Charts requires exactly three domestic charts.");
}
for (const chart of data.charts) {
  if (chart.source !== expected.get(chart.market)) {
    throw new Error(`Unexpected source for ${chart.market}: ${chart.source}`);
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
console.log("Verified 3 domestic charts / 30 ranked tracks.");