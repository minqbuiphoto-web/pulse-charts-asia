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

test("renders the nine-chart Pulse Charts shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /THE SOUND OF RIGHT NOW/);
  assert.match(html, /9(?:<!-- -->)? CHARTS/);
  assert.match(html, /Search tracks, artists, chart entries/);
  assert.doesNotMatch(html, /APPLE MUSIC DATA|PLAY ON APPLE MUSIC/i);
});

test("ships all nine chart snapshots", async () => {
  const data = JSON.parse(await readFile(new URL("../public/charts.json", import.meta.url), "utf8"));
  assert.equal(data.charts.length, 9);
  assert.deepEqual(new Set(data.charts.map((chart) => chart.market)), new Set(["KR", "JP", "CN"]));
  assert.ok(data.charts.every((chart) => chart.songs.length === 10));
  assert.ok(data.charts.some((chart) => chart.id === "kr-ost-trending"));
  assert.ok(data.charts.some((chart) => chart.id === "cn-ballad-trending"));
  assert.doesNotMatch(JSON.stringify(data), /Apple Music/i);
  assert.ok(data.charts.every((chart) => chart.songs.every((song) => song.artworkUrl === "")));
});