function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validSunoUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!new Set(["suno.com", "www.suno.com"]).has(url.hostname.toLowerCase())) return null;
    if (!/^\/(?:song\/[a-f0-9-]{36}|s\/[a-z0-9_-]{1,128})\/?$/i.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Chỉ hỗ trợ GET." });
  const originalUrl = validSunoUrl(first(request.query?.url));
  if (!originalUrl) return response.status(400).json({ error: "Hãy dán link bài hát Suno dạng suno.com/song/... hoặc suno.com/s/..." });

  try {
    const endpoint = new URL("https://studio-api-prod.suno.com/api/oembed");
    endpoint.searchParams.set("url", originalUrl);
    const upstream = await fetch(endpoint, {
      headers: { accept: "application/json", "user-agent": "Pulse-Charts-Audio-Lab/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) return response.status(upstream.status === 404 ? 404 : 502).json({ error: "Suno chưa cho phép mở trình nghe cho link này. Hãy kiểm tra link hoặc quyền hiển thị của bài." });
    const data = await upstream.json();
    const iframeUrl = validEmbedUrl(data.iframe_url);
    if (!iframeUrl) return response.status(502).json({ error: "Suno không trả trình phát hợp lệ cho bài này." });
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    return response.status(200).json({ title: String(data.title ?? "Bài hát Suno").slice(0, 240), iframeUrl, originalUrl });
  } catch (error) {
    console.warn("[suno-oembed] failed", String(error));
    return response.status(502).json({ error: "Chưa kết nối được với Suno. Hãy thử lại sau." });
  }
}

function validEmbedUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && new Set(["suno.com", "www.suno.com"]).has(url.hostname.toLowerCase()) && /^\/embed\/[a-f0-9-]{36}\/?$/i.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export { validSunoUrl, validEmbedUrl };
