import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the thirteen-chart Pulse Charts shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /THE SOUND OF RIGHT NOW/);
  assert.match(html, /13(?:<!-- -->)? CHARTS/);
  assert.match(html, /Search tracks, artists, chart entries/);
  assert.doesNotMatch(html, /APPLE MUSIC DATA|PLAY ON APPLE MUSIC/i);
});

test("ships all thirteen chart snapshots", async () => {
  const data = JSON.parse(await readFile(new URL("../public/charts.json", import.meta.url), "utf8"));
  assert.equal(data.charts.length, 13);
  assert.deepEqual(new Set(data.charts.map((chart) => chart.market)), new Set(["KR", "JP", "CN"]));
  assert.ok(data.charts.every((chart) => chart.songs.length === 20));
  assert.equal(data.charts.reduce((total, chart) => total + chart.songs.length, 0), 260);
  assert.ok(data.charts.some((chart) => chart.id === "kr-ost-trending"));
  assert.ok(data.charts.some((chart) => chart.id === "cn-ballad-trending"));
  const balladCharts = data.charts.filter((chart) => chart.id.includes("ballad"));
  assert.ok(balladCharts.every((chart) => chart.songs.every((song) => /ballad/i.test(song.genre))));
  assert.doesNotMatch(JSON.stringify(balladCharts), /RESCENE|aespa|ILLIT|fromis_9|Hearts2Hearts/i);
  const koreanBallad = data.charts.find((chart) => chart.id === "kr-ballad-trending");
  const sixMonthCutoff = new Date(data.generatedAt);
  sixMonthCutoff.setUTCMonth(sixMonthCutoff.getUTCMonth() - 6);
  assert.ok(koreanBallad.songs.every((song) => /^\d{4}-\d{2}-\d{2}$/.test(song.releaseDate)));
  assert.ok(koreanBallad.songs.every((song) => new Date(`${song.releaseDate}T00:00:00Z`) >= sixMonthCutoff));
  assert.doesNotMatch(JSON.stringify(koreanBallad), /Drowning|벌써 일년|예뻤어|사랑하게 될 거야/i);
  const evergreenCharts = data.charts.filter((chart) => chart.id.includes("evergreen"));
  assert.equal(evergreenCharts.length, 4);
  assert.ok(evergreenCharts.every((chart) => chart.songs.length === 20));
  assert.ok(evergreenCharts.filter((chart) => chart.id.includes("2016-2026")).every((chart) => chart.songs.every((song) => Number(song.releaseDate) >= 2016 && Number(song.releaseDate) <= 2026)));
  assert.ok(evergreenCharts.filter((chart) => chart.id.includes("2006-2015")).every((chart) => chart.songs.every((song) => Number(song.releaseDate) >= 2006 && Number(song.releaseDate) <= 2015)));
  assert.doesNotMatch(JSON.stringify(data), /Apple Music/i);
  assert.ok(data.charts.every((chart) => chart.songs.every((song) => song.artworkUrl === "")));
});