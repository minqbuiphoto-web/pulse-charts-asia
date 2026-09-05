const SNAPSHOT_URL = "https://raw.githubusercontent.com/minqbuiphoto-web/pulse-charts-asia/main/public/charts.json";

export function validSnapshot(data) {
  return Boolean(data && Number.isFinite(Date.parse(data.generatedAt)) && Array.isArray(data.charts) && data.charts.length === 19 && new Set(data.charts.map(chart => chart.id)).size === 19 && data.charts.every(chart =>
    typeof chart.id === "string" && typeof chart.label === "string" && ["KR", "JP", "CN"].includes(chart.market) && Number.isFinite(Date.parse(chart.updatedAt)) && /^https:\/\//.test(chart.sourceUrl) && Array.isArray(chart.songs) && chart.songs.length === (chart.id === "cn-tme-uni" ? 10 : chart.id === "cn-tme-wave" ? 20 : 50) && chart.songs.every((song, index) => song.rank === index + 1 && typeof song.id === "string" && typeof song.title === "string" && typeof song.artist === "string")
  ));
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET only" });
  try {
    const upstream = await fetch(SNAPSHOT_URL, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
    if (!upstream.ok) throw new Error(`Source returned ${upstream.status}`);
    const data = await upstream.json();
    if (!validSnapshot(data)) throw new Error("Invalid chart snapshot");
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return response.status(200).json(data);
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "Chưa tải được bản mới. Hệ thống giữ bản đã xác minh gần nhất." });
  }
}
