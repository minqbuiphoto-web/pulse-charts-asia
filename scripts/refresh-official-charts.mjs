import { readFile, writeFile } from "node:fs/promises";

const mainFile = new URL("../app/charts-main.json", import.meta.url);
const chinaFile = new URL("../app/charts-ost.json", import.meta.url);
const main = JSON.parse(await readFile(mainFile, "utf8"));
const china = JSON.parse(await readFile(chinaFile, "utf8"));

const USER_AGENT = "Pulse-Charts-Official-Refresh/2.0 (+https://pulse-charts-asia.vercel.app)";
const CIRCLE_ROOT = "https://circlechart.kr";
const BILLBOARD_URL = "https://www.billboard-japan.com/charts/detail?a=hot100";
const TME_UNI_URL = "https://yobang.tencentmusic.com/chart/uni-chart/rankList/";
const TME_WAVE_URL = "https://chart.tencentmusic.com/wave-chart";
const TME_API = "https://chart.tencentmusic.com/unichartsapi";

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json", ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  throw new Error(`Không thể đọc nguồn chính thức ${url}: ${lastError?.message ?? "unknown error"}`);
}

function findChart(document, id) {
  const chart = document.charts.find((item) => item.id === id);
  if (!chart) throw new Error(`Không tìm thấy bảng ${id}.`);
  return chart;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function normalizeRows(id, rows) {
  return rows.slice(0, 50).map((song, index) => ({ ...song, rank: index + 1, id: `${id}-${index + 1}`, artworkUrl: "" }));
}

function isoAtEndOfDay(date, offset) {
  return `${date.replaceAll(".", "-")}T23:59:00${offset}`;
}

async function refreshCircle(serviceGbn, chartId) {
  const chart = findChart(main, chartId);
  const pageUrl = `${CIRCLE_ROOT}/page_chart/onoff.circle?serviceGbn=${serviceGbn}&termGbn=week`;
  const html = await (await request(pageUrl)).text();
  const hitYear = html.match(/var hitYear = "(\d{4})"/)?.[1];
  const targetTime = html.match(/var targetTime = "(\d{1,2})"/)?.[1];
  if (!hitYear || !targetTime) throw new Error(`Circle không trả kỳ mới nhất cho ${chartId}.`);
  const issue = `${hitYear}${targetTime.padStart(2, "0")}`;
  const selected = html.match(new RegExp(`<option value="${issue}"[^>]*selected[^>]*>([^<]+)</option>`))?.[1];
  const endDate = selected?.match(/~(\d{4}\.\d{2}\.\d{2})/)?.[1];
  if (!endDate) throw new Error(`Circle thiếu ngày kết thúc kỳ ${issue}.`);

  const body = new URLSearchParams({
    nationGbn: "T", serviceGbn, termGbn: "week", hitYear, targetTime,
    yearTime: "3", curUrl: `circlechart.kr/page_chart/onoff.circle?serviceGbn=${serviceGbn}`,
  });
  const payload = await (await request(`${CIRCLE_ROOT}/data/api/chart/onoff`, {
    method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", origin: CIRCLE_ROOT, referer: pageUrl, accept: "application/json" },
  })).json();
  const list = Object.values(payload.List ?? {}).sort((a, b) => Number(a.SERVICE_RANKING) - Number(b.SERVICE_RANKING));
  if (list.length < 50) throw new Error(`Circle ${chartId} chỉ trả ${list.length}/50 dòng.`);
  chart.source = serviceGbn === "ALL" ? "Circle Digital Chart" : "Circle Download Chart";
  chart.sourceUrl = pageUrl;
  chart.updatedAt = isoAtEndOfDay(endDate, "+09:00");
  chart.syncWarning = `OFFICIAL TOP 50 · Circle ${hitYear} Week ${targetTime} (${selected.trim()}). Toàn bộ vị trí 1–50 được lấy trực tiếp từ bảng chính thức; không chèn dòng discovery.`;
  chart.songs = normalizeRows(chart.id, list.map((row) => ({
    title: decodeHtml(row.SONG_NAME), artist: decodeHtml(row.ARTIST_NAME), releaseDate: "KR",
    genre: `${Number(row.ROW_CNT || 0).toLocaleString("en-US")} pts · ${row.RankStatus === "new" ? "NEW" : row.RankStatus === "same" ? "SAME" : `${String(row.RankStatus).toUpperCase()} ${row.RankChange}`}`,
    url: pageUrl, artistUrl: pageUrl,
  })));
  console.log(`✓ ${chart.label}: ${issue}, ${chart.songs.length} vị trí chính thức`);
}

async function refreshBillboardJapan() {
  const chart = findChart(main, "jp-hot100");
  const html = await (await request(BILLBOARD_URL)).text();
  const published = html.match(/<p class="date">\s*\[\s*(\d{4}\/\d{2}\/\d{2})/)?.[1];
  if (!published) throw new Error("Billboard Japan không trả ngày công bố mới nhất.");
  const rows = [];
  const pattern = /<tr class="rank(\d+)"[^>]*>[\s\S]*?<p class="musuc_title">([\s\S]*?)<\/p>[\s\S]*?<p class="artist_name">([\s\S]*?)<\/p>[\s\S]*?<\/tr>/g;
  for (const match of html.matchAll(pattern)) {
    const rank = Number(match[1]);
    if (rank > 50 || rows.some((song) => song.rank === rank)) continue;
    rows.push({ rank, title: decodeHtml(match[2]), artist: decodeHtml(match[3]), releaseDate: "JP", genre: `Billboard Japan Hot 100 #${rank}`, url: BILLBOARD_URL, artistUrl: BILLBOARD_URL });
  }
  rows.sort((a, b) => a.rank - b.rank);
  if (rows.length !== 50 || rows.some((song, index) => song.rank !== index + 1)) throw new Error(`Billboard Japan chỉ phân tích được ${rows.length}/50 dòng.`);
  chart.source = "Billboard Japan Hot 100";
  chart.sourceUrl = BILLBOARD_URL;
  chart.updatedAt = `${published.replaceAll("/", "-")}T23:59:00+09:00`;
  chart.syncWarning = `OFFICIAL TOP 50 · Billboard Japan Hot 100 công bố ${published}. Toàn bộ vị trí 1–50 được lấy trực tiếp từ bảng chính thức; không chèn dòng discovery.`;
  chart.songs = normalizeRows(chart.id, rows);
  console.log(`✓ ${chart.label}: ${published}, 50 vị trí chính thức`);
}

function parseNextData(html, sourceName) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error(`${sourceName} không trả dữ liệu xếp hạng.`);
  return JSON.parse(raw);
}

function tmeTime(value) {
  const match = String(value ?? "").match(/(\d{4})[.-](\d{2})[.-](\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return new Date().toISOString();
  return `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "23"}:${match[5] ?? "59"}:00+08:00`;
}

async function refreshTmeUni() {
  const chart = findChart(china, "cn-tme-uni");
  const data = parseNextData(await (await request(TME_UNI_URL)).text(), "TME Uni Chart").props.pageProps;
  const official = data.chartsList ?? [];
  if (official.length < 10) throw new Error(`TME Uni chỉ trả ${official.length}/10 vị trí.`);
  const rows = official.slice(0, 10).map((song) => ({
    title: song.songName, artist: song.singerName || "TME artist", releaseDate: "CN",
    genre: `${song.uniIndex} score${song.newFlag ? " · NEW" : ""}`, url: TME_UNI_URL, artistUrl: TME_UNI_URL,
  }));
  chart.source = "Tencent Music Uni Chart";
  chart.sourceUrl = TME_UNI_URL;
  chart.updatedAt = tmeTime(data.SSG_UPDATETIME ?? data.updateTime);
  chart.syncWarning = `OFFICIAL TOP 10 · ${data.issueTitle ?? data.issue ?? "TME Uni"}. Nguồn công khai trả 10 vị trí; chỉ hiển thị các vị trí xác minh được, không chèn bài từ kỳ cũ.`;
  chart.songs = normalizeRows(chart.id, rows);
  console.log(`✓ ${chart.label}: ${data.issueTitle ?? data.issue}, 10 vị trí chính thức`);
}

async function refreshTmeWave() {
  const chart = findChart(china, "cn-tme-wave");
  const years = await (await request(`${TME_API}/pc/uniprorec/year`, { headers: { accept: "application/json", referer: TME_WAVE_URL } })).json();
  const year = String(years.data?.years?.[0] ?? new Date().getFullYear());
  const scopes = await (await request(`${TME_API}/pc/uniprorec/scope?year=${encodeURIComponent(year)}&sort=desc`, { headers: { accept: "application/json", referer: TME_WAVE_URL } })).json();
  const issue = scopes.data?.infos?.find((item) => item.isCurrent) ?? scopes.data?.infos?.[0];
  if (!issue?.chartId) throw new Error("TME Wave không trả kỳ hiện tại.");
  const payload = await (await request(`${TME_API}/pc/uniprorec/song?uniProRecChartId=${issue.chartId}&strat=0&end=20`, { headers: { accept: "application/json", referer: TME_WAVE_URL } })).json();
  const official = payload.data?.content ?? [];
  if (official.length !== 20) throw new Error(`TME Wave chỉ trả ${official.length}/20 vị trí.`);
  const rows = official.map((song) => ({
    title: song.songName, artist: song.singers?.join("、") || "TME artist", releaseDate: "CN",
    genre: `${song.showScore || song.score} expert score`, url: TME_WAVE_URL, artistUrl: TME_WAVE_URL,
  }));
  const month = issue.title.match(/(\d{4})年(\d{1,2})月/) ?? [];
  const monthEnd = month[1] ? new Date(Date.UTC(Number(month[1]), Number(month[2]), 0)).getUTCDate() : 1;
  chart.source = "Tencent Music Wave Chart";
  chart.sourceUrl = TME_WAVE_URL;
  chart.updatedAt = month[1] ? `${month[1]}-${String(month[2]).padStart(2, "0")}-${monthEnd}T23:59:00+08:00` : new Date().toISOString();
  chart.syncWarning = `OFFICIAL TOP 20 · ${issue.title}. Đây là kỳ mới nhất nguồn TME Wave đang công bố, không phải bảng tuần. Không chèn bài từ kỳ cũ.`;
  chart.songs = normalizeRows(chart.id, rows);
  console.log(`✓ ${chart.label}: ${issue.title}, 20 vị trí chính thức`);
}

await refreshCircle("ALL", "kr-circle-digital");
await refreshCircle("S1020", "kr-circle-download");
await refreshBillboardJapan();
await refreshTmeUni();
await refreshTmeWave();

const generatedAt = new Date().toISOString();
for (const chart of [...main.charts, ...china.charts]) {
  if (["kr-circle-digital", "kr-circle-download", "jp-hot100", "cn-tme-uni", "cn-tme-wave"].includes(chart.id)) chart.checkedAt = generatedAt;
}
main.generatedAt = generatedAt;
china.generatedAt = generatedAt;
await writeFile(mainFile, JSON.stringify(main, null, 2) + "\n", "utf8");
await writeFile(chinaFile, JSON.stringify(china, null, 2) + "\n", "utf8");
console.log(`Đã cập nhật 5 bảng nguồn chính thức lúc ${generatedAt}.`);
