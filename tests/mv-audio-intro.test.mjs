import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("delays the intact song instead of concatenating synthetic intro audio",async()=>{
  const source=await readFile(new URL("../public/pulse-audio-ai-server.py",import.meta.url),"utf8");
  assert.match(source,/version="5\.0"/);
  assert.match(source,/mvExactAudioIntro/);
  assert.match(source,/mvAudioHeadPreserved/);
  assert.match(source,/mvAudioPtsReset/);
  assert.match(source,/mvPhysicalAudioLead/);
  assert.match(source,/mvLandscapeAudioZeroStart/);
  assert.match(source,/mvAudioHeadPadding/);
  assert.match(source,/mvFullPreviewTimeline/);
  assert.match(source,/if video_format != "vertical":\s+clip_start = 0\.0/);
  assert.match(source,/intro_delay_seconds = max\(0\.0, intro_duration \+ audio_head_padding\)/);
  assert.match(source,/atrim=start=\{clip_start:\.3f\}:end=\{clip_end:\.3f\},asetpts=N\/SR\/TB/);
  assert.doesNotMatch(source,/atrim=start=\{clip_start:\.3f\}:end=\{clip_end:\.3f\},asetpts=PTS-STARTPTS/);
  assert.match(source,/anullsrc=r=48000:cl=stereo:d=\{intro_delay_seconds:\.3f\}\[lead\]/);
  assert.match(source,/\[lead\]\[song\]concat=n=2:v=0:a=1/);
  assert.doesNotMatch(source,/\[song\]adelay=/);
  assert.match(source,/asetpts=N\/SR\/TB\[a\]/);
});

test("uses one exact timeline for cut-video preview and MP4 export",async()=>{
  const [page,server]=await Promise.all([
    readFile(new URL("../app/mv-studio/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../public/pulse-audio-ai-server.py",import.meta.url),"utf8"),
  ]);
  assert.match(page,/lyricSyncOffset:0/);
  assert.match(page,/toMvTimeline\(rows,sourceStart,sourceEnd,mvAudioStart,lyricSyncOffset\)/);
  assert.match(page,/toMvTimeline\(rows,renderStart,renderEnd,renderAudioStart,lyricSyncOffset\)/);
  assert.match(page,/form\.append\("exact_timeline","true"\)/);
  assert.match(page,/REVIEW = FILE XUẤT/);
  assert.doesNotMatch(page,/TỰ ĐỘNG · SỚM 1\.0 GIÂY/);
  assert.match(server,/mvExactCutTimeline/);
  assert.match(server,/export_lyric_lead = 0\.0 if exact_timeline/);
  assert.match(server,/and not exact_timeline/);
  assert.match(server,/output_end = intro_duration \+ audio_head_padding \+ clip_end - clip_start/);
});

test("previews thumbnail, audio protection gap, and original song on one timeline",async()=>{
  const page=await readFile(new URL("../app/mv-studio/page.tsx",import.meta.url),"utf8");
  assert.match(page,/THANH XEM TRƯỚC TOÀN BỘ MV/);
  assert.match(page,/ĐẨY ĐIỂM BẮT ĐẦU AUDIO GỐC/);
  assert.match(page,/audioHeadPadding:clampAudioHeadPadding/);
  assert.match(page,/mvAudioStart=mvIntro\+audioHeadPadding/);
  assert.match(page,/seekFullPreview/);
});

test("requires one fresh original upload for legacy saved MV projects",async()=>{
  const page=await readFile(new URL("../app/mv-studio/page.tsx",import.meta.url),"utf8");
  assert.match(page,/pulse-mv-source-verified-/);
  assert.match(page,/Đã thay bằng WAV gốc đầy đủ và giữ nguyên timeline hiện tại/);
  assert.match(page,/audioFile=mode==="music"\?\(sourceAudioFileRef\.current\|\|audioFileRef\.current\)/);
});
