import assert from "node:assert/strict";
import test from "node:test";
import {selectBestLyrics} from "../api/lyrics-search.js";

const lyric=(id,duration,syncedLyrics="")=>({
  id,
  trackName:"三拜红尘凉",
  artistName:"尹昔眠",
  duration,
  plainLyrics:"第一句\n第二句",
  syncedLyrics
});

test("prefers the lyric recording whose duration matches the selected video",()=>{
  const selected=selectBestLyrics([
    lyric(36903275,226),
    lyric(34680613,176),
    lyric(10108470,176)
  ],"三拜红尘凉","尹昔眠",177);
  assert.equal(selected.id,34680613);
});

test("does not let a badly mismatched synced lyric beat the correct recording",()=>{
  const selected=selectBestLyrics([
    lyric(1,226,"[00:10.00]第一句"),
    lyric(2,176)
  ],"三拜红尘凉","尹昔眠",177);
  assert.equal(selected.id,2);
});
