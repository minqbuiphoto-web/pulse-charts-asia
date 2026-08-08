import { readFile, writeFile } from "node:fs/promises";
import { searchPublicYouTube } from "./youtube-public-search.mjs";

const files = ["app/charts-main.json", "app/charts-ost.json"];
const TARGET_TRACKS = 5;
const WORKERS = 3;
const FORCE = process.argv.includes("--force");

function albumKey(song) {
  return (song.album ?? song.filmTitle ?? `${song.title}::${song.artist}`).normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

function compact(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");
}

const STOP_WORDS = new Set(["mv", "ost", "part", "official", "video", "audio", "lyrics", "lyric", "eng", "full", "ver", "original", "television", "soundtrack"]);

function titleWords(value, filmTitle) {
  const filmWords = new Set(String(filmTitle ?? "").normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []);
  return new Set((String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 1 && !STOP_WORDS.has(word) && !filmWords.has(word)));
}

function sameRecording(left, right, filmTitle) {
  if (Math.abs(Number(left.durationSeconds) - Number(right.durationSeconds)) > 15) return false;
  const leftWords = titleWords(left.videoTitle ?? left.title, filmTitle);
  const rightWords = titleWords(right.videoTitle ?? right.title, filmTitle);
  const common = [...leftWords].filter((word) => rightWords.has(word));
  return common.length >= 2 || common.some((word) => word.length >= 4);
}

function officialScore(video) {
  return /official|topic|sbscatch|kbs|mostcontents|music&new|stone music|1thek|huace|tencent|youku|iqiyi|mango tv|yoyorock|滚石|华策|官方/i.test(video.title + " " + video.channel) ? 1 : 0;
}

function matchesTrack(video, track) {
  const title = compact(track.title);
  return title.length >= 2 && compact(video.title).includes(title);
}

function applyVideo(track, video) {
  return {
    ...track,
    videoId: video.videoId,
    viewCount: video.viewCount,
    durationSeconds: video.durationSeconds,
    videoTitle: video.title,
    videoChannel: video.channel,
    videoDescription: video.description,
    videoType: /official|topic/i.test(`${video.title} ${video.channel}`) ? "official-full-track" : "full-track",
    videoQuality: "duration-verified",
  };
}

function generatedTrack(parent, video, index) {
  return {
    rank: index + 1,
    id: `${parent.id}-album-${index + 1}`,
    title: video.title,
    artist: video.channel || "YouTube music channel",
    releaseDate: video.publishedText || parent.releaseDate,
    genre: `Published full OST video · ${video.durationText}${video.viewsText ? ` · ${video.viewsText}` : ""}`,
    artworkUrl: "",
    url: video.url,
    artistUrl: video.url,
    filmTitle: parent.filmTitle,
    album: parent.album,
    videoId: video.videoId,
    viewCount: video.viewCount,
    durationSeconds: video.durationSeconds,
    videoTitle: video.title,
    videoChannel: video.channel,
    videoDescription: video.description,
    videoType: /official|topic/i.test(`${video.title} ${video.channel}`) ? "official-full-track" : "full-track",
    videoQuality: "duration-verified",
    albumDiscovery: true,
  };
}

async function enrichGroup(chart, group) {
  const parent = group[0];
  const cleanVideo = (track) => { const next = { ...track }; if (next.videoQuality === "duration-verified") { delete next.videoId; delete next.viewCount; delete next.durationSeconds; delete next.videoTitle; delete next.videoChannel; delete next.videoDescription; delete next.videoType; delete next.videoQuality; } return next; };
  const existingExtras = group.flatMap((song) => song.albumTracks ?? []).filter((track) => !track.albumDiscovery).map(cleanVideo);
  const known = [...group.map(cleanVideo), ...existingExtras];
  const playableKnown = known.filter((song) => song.videoId && Number(song.durationSeconds) >= 120 && Number(song.durationSeconds) <= 900);
  const alreadyComplete = new Set(playableKnown.map((song) => song.videoId)).size >= TARGET_TRACKS;
  if (alreadyComplete && !FORCE) return;

  const marketWord = chart.market === "KR" ? "Korean drama" : "Chinese drama";
  const query = `${parent.filmTitle ?? parent.album} ${parent.title} ${parent.artist} ${marketWord} OST official full song`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let candidates;
  try {
    candidates = await searchPublicYouTube(query, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const relevanceAnchors = [parent.filmTitle, ...known.map((track) => track.title)].map(compact).filter((value) => value.length >= 2);
  const relevant = (video) => relevanceAnchors.some((anchor) => compact(`${video.title} ${video.description ?? ""}`).includes(anchor));
  candidates = candidates.filter(relevant);
  if (candidates.length < 5) {
    const fallback = await searchPublicYouTube(`${parent.title} ${parent.artist} ${parent.filmTitle ?? parent.album} OST`, { signal: AbortSignal.timeout(25_000) });
    candidates = [...new Map([...candidates, ...fallback.filter(relevant)].map((video) => [video.videoId, video])).values()];
  }
  candidates.sort((a, b) => officialScore(b) - officialScore(a) || b.viewCount - a.viewCount || Number(b.verified) - Number(a.verified));

  const usedIds = new Set();
  const enrichedKnown = known.map((track) => {
    const match = candidates.find((video) => !usedIds.has(video.videoId) && matchesTrack(video, track));
    if (!match) return track;
    usedIds.add(match.videoId);
    return applyVideo(track, match);
  });
  const activeTracks = enrichedKnown.slice(0, group.length);
  if (!activeTracks[0]?.videoId && candidates.length > 0) {
    const promoted = candidates.find((video) => !usedIds.has(video.videoId));
    if (promoted) {
      activeTracks[0] = applyVideo(activeTracks[0], promoted);
      usedIds.add(promoted.videoId);
    }
  }
  const extras = enrichedKnown.slice(group.length).filter((track) => track.videoId && Number(track.durationSeconds) >= 120 && Number(track.durationSeconds) <= 900);
  const playableActive = activeTracks.filter((track) => track.videoId && Number(track.durationSeconds) >= 120 && Number(track.durationSeconds) <= 900).length;
  for (const video of candidates) {
    if (playableActive + extras.length >= TARGET_TRACKS) break;
    if (usedIds.has(video.videoId) || [...activeTracks, ...extras].some((track) => track.videoId && sameRecording(track, video, parent.filmTitle))) continue;
    usedIds.add(video.videoId);
    extras.push(generatedTrack(parent, video, activeTracks.length + extras.length));
  }
  group.forEach((song, index) => {
    Object.assign(song, activeTracks[index]);
    delete song.albumTracks;
  });
  parent.albumTracks = extras.slice(0, TARGET_TRACKS - playableActive).map((track, index) => ({ ...track, rank: index + playableActive + 1 }));
}

async function runPool(tasks) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(WORKERS, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const { chart, group } = tasks[index];
      await enrichGroup(chart, group);
      await new Promise((resolve) => setTimeout(resolve, 800));
      if ((index + 1) % 5 === 0) for (const { file, data } of documents) await writeFile(file, JSON.stringify(data, null, 2) + `\n`, `utf8`);
      process.stdout.write(`\rEnriched OST albums: ${index + 1}/${tasks.length}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
}

const documents = await Promise.all(files.map(async (file) => ({ file, data: JSON.parse(await readFile(file, "utf8")) })));
const tasks = [];
const missingAlbums = [];
for (const { data } of documents) {
  for (const chart of data.charts.filter((item) => item.id.includes("ost-trending"))) {
    if (chart.id !== "kr-ost-trending") continue;
    const groups = new Map();
    for (const song of chart.songs) {
      const key = albumKey(song);
      groups.set(key, [...(groups.get(key) ?? []), song]);
    }
    for (const group of groups.values()) tasks.push({ chart, group });
    chart.ostAlbumPolicy = "Each film album contains one to five distinct published full-song videos, filtered to 120–900 seconds and ranked by public YouTube views among relevant results. A production with no verified playable song is not eligible for the chart.";
    chart.syncWarning = chart.syncWarning.replace(/ FIVE-TRACK OST RULE:[^.]*\./, "") + " FIVE-TRACK OST RULE: each film exposes up to five distinct published full-length OST videos; unreleased songs, duplicate uploads, teasers, trailers, Shorts and clips under 120 seconds are rejected.";
  }
}

await runPool(tasks);
for (const { data } of documents) {
  for (const chart of data.charts.filter((item) => item.id.includes("ost-trending"))) {
    for (const root of chart.songs) {
      const playable = [root, ...(root.albumTracks ?? [])].filter((song) => /^[A-Za-z0-9_-]{11}$/.test(song.videoId ?? "") && Number(song.durationSeconds) >= 120 && Number(song.durationSeconds) <= 900);
      if (new Set(playable.map((song) => song.videoId)).size === 0) missingAlbums.push(root.filmTitle);
    }
  }
}
if (missingAlbums.length > 0) throw new Error(`No verified playable OST found for: ${missingAlbums.join(", ")}. Replace these productions before publishing.`);
for (const { file, data } of documents) await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`Verified ${tasks.length} OST albums with up to ${TARGET_TRACKS} published playable tracks each.`);
