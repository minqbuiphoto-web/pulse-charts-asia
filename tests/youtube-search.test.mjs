import assert from "node:assert/strict";
import test from "node:test";
import {rankedStudioCandidates} from "../api/youtube-search.js";

const video=(videoId,title,channel,views="1,000 views",length="3:00")=>({
  videoRenderer:{
    videoId,
    title:{runs:[{text:title}]},
    ownerText:{runs:[{text:channel}]},
    viewCountText:{simpleText:views},
    lengthText:{simpleText:length}
  }
});

test("prefers official studio audio and removes live-stage results",()=>{
  const data={contents:[
    video("AAAAAAAAAAA","Example Song LIVE at Seoul Concert","Example Official","20,000,000 views"),
    video("BBBBBBBBBBB","Example Song (Official Audio)","Example - Topic","2,000,000 views"),
    video("CCCCCCCCCCC","Example Song fancam stage","Fan Channel","30,000,000 views")
  ]};
  const candidates=rankedStudioCandidates(data,"Example Song official music video");
  assert.equal(candidates[0].videoId,"BBBBBBBBBBB");
  assert.deepEqual(candidates.map((candidate)=>candidate.videoId),["BBBBBBBBBBB"]);
  assert.equal(candidates[0].sourceType,"studio");
  assert.equal(candidates[0].durationSeconds,180);
});

test("removes Korean and Chinese live uploads",()=>{
  const data={contents:[
    video("DDDDDDDDDDD","노래 제목 라이브 무대","방송국"),
    video("EEEEEEEEEEE","歌曲名称 演唱会现场版","频道"),
    video("FFFFFFFFFFF","歌曲名称 Official MV","歌手 Official")
  ]};
  const candidates=rankedStudioCandidates(data,"歌曲名称");
  assert.deepEqual(candidates.map((candidate)=>candidate.videoId),["FFFFFFFFFFF"]);
});
