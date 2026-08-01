import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers:{ accept:"text/html" } }), {
    ASSETS:{ fetch:async () => new Response("Not found", { status:404 }) },
  }, { waitUntil(){}, passThroughOnException(){} });
}

test("server-renders the Pulse Charts product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Pulse Charts — Bảng xếp hạng âm nhạc châu Á<\/title>/i);
  assert.match(html, /Bắt nhịp những ca khúc/);
  assert.match(html, /Tìm bài hát, nghệ sĩ hoặc phim/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships seven complete charts in editable JSON", async () => {
  const [jsonText,page] = await Promise.all([
    readFile(new URL("../public/charts.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  const data = JSON.parse(jsonText);
  assert.equal(data.charts.length, 7);
  assert.ok(data.charts.every((chart) => chart.songs.length === 10));
  assert.deepEqual(new Set(data.charts.map((chart) => chart.market)), new Set(["KR","JP","CN"]));
  assert.match(page, /fetch\("charts\.json"\)/);
  assert.match(page, /aria-live="polite"/);
});
