import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(){ const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("test",`${process.pid}-${Date.now()}`);const {default:worker}=await import(workerUrl.href);return worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}}) }
test("renders the live Pulse Charts shell",async()=>{ const response=await render();assert.equal(response.status,200);const html=await response.text();assert.match(html,/LIVE DATA/);assert.match(html,/SYNCED FROM APPLE MUSIC/);assert.match(html,/Search songs, artists or genres/);assert.doesNotMatch(html,/Dữ liệu thật|Bảng xếp hạng|Tìm bài hát/i) });
test("ships three verified live storefronts",async()=>{ const data=JSON.parse(await readFile(new URL("../public/charts.json",import.meta.url),"utf8"));assert.equal(data.charts.length,3);assert.ok(data.charts.every((chart)=>chart.source==="Apple Music"&&chart.songs.length===10));assert.deepEqual(new Set(data.charts.map((chart)=>chart.market)),new Set(["KR","JP","CN"]));for(const chart of data.charts){for(const song of chart.songs){assert.match(song.url,/^https:\/\/music\.apple\.com\//);assert.ok(song.artworkUrl)}} });
