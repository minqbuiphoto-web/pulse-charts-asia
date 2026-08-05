const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const REJECTED_TITLE = /\b(teaser|trailer|preview|reaction|making|behind(?:\s+the\s+scenes)?|dance\s+challenge|shorts?|snippet|clip|instrumental|piano|cover|karaoke|fancam|fmv|live(?:\s+stage|\s+performance)?)\b/i;
const UNOFFICIAL_LYRICS = /\b(?:lyrics?|sub|vietsub|thaisub|easy lyrics?)\b/i;

function textOf(value) {
  if (!value) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run?.text ?? "").join("");
  return "";
}

function durationSeconds(value) {
  const parts = String(value ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function numericViews(value) {
  const compact = String(value ?? "").replace(/,/g, "").trim();
  const match = compact.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1;
  return Math.round(Number(match[1]) * multiplier) || 0;
}

function initialDataFromHtml(html) {
  const markers = ["var ytInitialData = ", "ytInitialData = "];
  const marker = markers.map((value) => ({ value, index: html.indexOf(value) })).find((item) => item.index >= 0);
  if (!marker) throw new Error("YouTube search metadata was not found.");
  const start = html.indexOf("{", marker.index + marker.value.length);
  if (start < 0) throw new Error("YouTube search metadata is incomplete.");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  throw new Error("YouTube search metadata did not terminate.");
}

function collectVideoRenderers(value, results = []) {
  if (!value || typeof value !== "object") return results;
  if (value.videoRenderer) results.push(value.videoRenderer);
  for (const child of Object.values(value)) collectVideoRenderers(child, results);
  return results;
}

export function parseYouTubeSearchData(data) {
  const seen = new Set();
  return collectVideoRenderers(data).flatMap((renderer) => {
    const videoId = String(renderer.videoId ?? "");
    if (!VIDEO_ID.test(videoId) || seen.has(videoId)) return [];
    seen.add(videoId);
    const title = textOf(renderer.title);
    const channel = textOf(renderer.ownerText) || textOf(renderer.longBylineText) || textOf(renderer.shortBylineText);
    const description = (renderer.detailedMetadataSnippets ?? []).map((item) => textOf(item?.snippetText)).filter(Boolean).join(" ");
    const durationText = textOf(renderer.lengthText) || renderer.thumbnailOverlays?.map((item) => textOf(item?.thumbnailOverlayTimeStatusRenderer?.text)).find(Boolean) || "";
    const seconds = durationSeconds(durationText);
    const viewsText = textOf(renderer.viewCountText) || textOf(renderer.shortViewCountText);
    const publishedText = textOf(renderer.publishedTimeText);
    const badges = [...(renderer.badges ?? []), ...(renderer.ownerBadges ?? [])].map((badge) => textOf(badge?.metadataBadgeRenderer?.label)).join(" ");
    const isLive = Boolean(renderer.badges?.some((badge) => /live/i.test(textOf(badge?.metadataBadgeRenderer?.label)))) || /watching/i.test(viewsText);
    return [{
      videoId,
      title,
      channel,
      description,
      durationSeconds: seconds,
      durationText,
      viewCount: numericViews(viewsText),
      viewsText,
      publishedText,
      verified: /verified|official artist/i.test(badges),
      isLive,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    }];
  });
}

export function parseYouTubeSearchHtml(html) {
  return parseYouTubeSearchData(initialDataFromHtml(html));
}

export function isFullSongVideo(video) {
  return VIDEO_ID.test(video.videoId)
    && video.durationSeconds >= 120
    && video.durationSeconds <= 900
    && !video.isLive
    && !REJECTED_TITLE.test(video.title)
    && (!UNOFFICIAL_LYRICS.test(video.title) || /official[^\n]{0,20}lyric|lyric[^\n]{0,20}official/i.test(video.title));
}

let innertubeConfigPromise;

async function innertubeConfig() {
  if (!innertubeConfigPromise) innertubeConfigPromise = fetch("https://www.youtube.com", {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "cookie": "CONSENT=YES; SOCS=CAI",
      "user-agent": "Mozilla/5.0 (compatible; PulseCharts/1.0; +https://pulse-charts-asia.vercel.app/)",
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`YouTube bootstrap returned ${response.status}.`);
    const html = await response.text();
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
    if (!apiKey || !clientVersion) throw new Error("YouTube public client metadata was not found.");
    return { apiKey, clientVersion };
  });
  return innertubeConfigPromise;
}

async function searchInnertube(query, signal) {
  const { apiKey, clientVersion } = await innertubeConfig();
  const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "origin": "https://www.youtube.com" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
      query,
      params: "EgIQAQ%3D%3D",
    }),
  });
  if (!response.ok) throw new Error(`YouTube public search returned ${response.status}.`);
  return parseYouTubeSearchData(await response.json()).filter(isFullSongVideo);
}

export async function searchPublicYouTube(query, { signal } = {}) {
  try {
    const results = await searchInnertube(query, signal);
    if (results.length) return results;
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "US");
  url.searchParams.set("sp", "EgIQAQ%3D%3D");
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          "accept-language": "en-US,en;q=0.9",
          "cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+410; SOCS=CAI",
          "user-agent": "Mozilla/5.0 (compatible; PulseCharts/1.0; +https://pulse-charts-asia.vercel.app/)",
        },
      });
      if (!response.ok) throw new Error(`YouTube search returned ${response.status}.`);
      return parseYouTubeSearchHtml(await response.text()).filter(isFullSongVideo);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

