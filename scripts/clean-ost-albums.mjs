import { readFile, writeFile } from "node:fs/promises";

const files = ["app/charts-main.json", "app/charts-ost.json"];
const STOP_WORDS = new Set(["mv", "ost", "part", "official", "video", "audio", "lyrics", "lyric", "eng", "full", "ver", "original", "television", "soundtrack"]);

function albumKey(song) {
  return song.album ?? song.filmTitle ?? `${song.title}::${song.artist}`;
}

function words(value, filmTitle) {
  const filmWords = new Set(String(filmTitle ?? "").normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []);
  return new Set((String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word) && !filmWords.has(word)));
}

function sameRecording(left, right, filmTitle) {
  if (Math.abs(Number(left.durationSeconds) - Number(right.durationSeconds)) > 15) return false;
  const leftWords = words(left.videoTitle ?? left.title, filmTitle);
  const rightWords = words(right.videoTitle ?? right.title, filmTitle);
  const common = [...leftWords].filter((word) => rightWords.has(word));
  return common.length >= 2 || common.some((word) => word.length >= 4);
}

function officialScore(song) {
  const value = `${song.videoTitle ?? song.title} ${song.videoChannel ?? song.artist}`;
  return /official|topic|sbscatch|kbs|mostcontents|music&new|stone music|1thek|huace|tencent|youku|iqiyi|mango tv|yoyorock|滚石|华策|官方/i.test(value) ? 1 : 0;
}

function clearGeneratedVideo(song) {
  if (song.videoQuality !== "duration-verified") return;
  delete song.videoId;
  delete song.viewCount;
  delete song.durationSeconds;
  delete song.videoTitle;
  delete song.videoChannel;
  delete song.videoDescription;
  delete song.videoType;
  delete song.videoQuality;
}

for (const file of files) {
  const data = JSON.parse(await readFile(file, "utf8"));
  for (const chart of data.charts.filter((item) => item.id.includes("ost-trending"))) {
    const groups = new Map();
    for (const song of chart.songs) groups.set(albumKey(song), [...(groups.get(albumKey(song)) ?? []), song]);
    for (const group of groups.values()) {
      const root = group[0];
      const extras = group.flatMap((song) => song.albumTracks ?? []);
      const anchors = [root.filmTitle, ...group.map((song) => song.title)].map((value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "")).filter((value) => value.length >= 2);
      const candidates = [...group, ...extras]
        .filter((song) => song.videoId && Number(song.durationSeconds) >= 120 && Number(song.durationSeconds) <= 900)
        .filter((song) => { const haystack = `${song.videoTitle ?? song.title} ${song.videoDescription ?? ""}`.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, ""); return anchors.some((anchor) => haystack.includes(anchor)); })
        .sort((a, b) => officialScore(b) - officialScore(a) || (b.viewCount ?? 0) - (a.viewCount ?? 0));
      const selected = [];
      for (const candidate of candidates) {
        if (selected.length >= 5) break;
        if (selected.some((song) => song.videoId === candidate.videoId || sameRecording(song, candidate, root.filmTitle))) continue;
        selected.push(candidate);
      }
      const selectedIds = new Set(selected.map((song) => song.videoId));
      for (const song of group) {
        delete song.albumTracks;
        delete song.videoDescription;
        if (song.videoId && !selectedIds.has(song.videoId)) clearGeneratedVideo(song);
      }
      root.albumTracks = selected.filter((song) => !group.includes(song)).map((song, index) => { const { videoDescription, ...clean } = song; void videoDescription; return { ...clean, rank: index + 1 }; });
    }
  }
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

console.log("Deduplicated OST uploads and kept up to five distinct published songs per film.");

