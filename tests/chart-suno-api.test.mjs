import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import suno, { validSunoUrl, validEmbedUrl } from "../api/suno-oembed.js";
import charts, { validSnapshot } from "../api/charts-latest.js";

const song = "https://suno.com/song/e7d772da-2378-40c8-9872-90c2b8205ad7";
function response() {
  return { code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } };
}

test("only accepts official Suno song/share links, never credentials or other hosts", () => {
  assert.equal(validSunoUrl(song + "?tracking=abc#section"), song);
  assert.equal(validSunoUrl("https://suno.com/s/abc123"), "https://suno.com/s/abc123");
  for (const url of ["http://suno.com/s/abc", "https://suno.com.evil.test/s/abc", "https://user:pass@suno.com/s/abc", "https://suno.com:444/s/abc", "https://suno.com/library", "https://suno.com/s/", "javascript:alert(1)"]) assert.equal(validSunoUrl(url), null);
  assert.equal(validEmbedUrl(song.replace("/song/", "/embed/")), song.replace("/song/", "/embed/"));
  assert.equal(validEmbedUrl("https://evil.test/embed/abc"), null);
  assert.equal(validEmbedUrl("https://user:pass@suno.com/embed/e7d772da-2378-40c8-9872-90c2b8205ad7"), null);
});

test("Suno endpoint uses official oEmbed and rejects malicious embed responses", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).origin, "https://studio-api-prod.suno.com");
    return { ok: true, json: async () => ({ title: "Own song", iframe_url: song.replace("/song/", "/embed/") }) };
  });
  const success = response();
  await suno({ method: "GET", query: { url: song } }, success);
  assert.equal(success.code, 200);
  assert.equal(success.body.title, "Own song");
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ iframe_url: "https://evil.test/embed/a" }) }));
  const bad = response();
  await suno({ method: "GET", query: { url: song } }, bad);
  assert.equal(bad.code, 502);
  const invalid = response();
  await suno({ method: "GET", query: { url: "https://evil.test" } }, invalid);
  assert.equal(invalid.code, 400);
});

test("live charts preserve verified snapshot shape and refuse partial/bad sources", async (t) => {
  const data = JSON.parse(await readFile(new URL("../public/charts.json", import.meta.url), "utf8"));
  assert.equal(validSnapshot(data), true);
  assert.equal(validSnapshot({ ...data, charts: data.charts.slice(1) }), false);
  assert.equal(validSnapshot({ ...data, generatedAt: "not-a-date" }), false);
  const malformed = structuredClone(data);
  malformed.charts[0].songs[0].rank = 99;
  assert.equal(validSnapshot(malformed), false);
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => data }));
  const success = response();
  await charts({ method: "GET" }, success);
  assert.equal(success.code, 200);
  assert.equal(success.body.charts.length, 19);
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error("offline"); });
  const failure = response();
  await charts({ method: "GET" }, failure);
  assert.equal(failure.code, 503);
  assert.equal(failure.headers["Cache-Control"], "no-store");
});
