// Each caller supplies their own Replicate token. No shared billing credential.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = req.headers.authorization;
  if (!token?.startsWith("Bearer "))
    return res.status(401).json({ error: "Nhập khóa Replicate." });
  const api = "https://api.replicate.com/v1";
  let url, body;
  if (req.method === "GET" && /^[a-z0-9]{8,80}$/i.test(req.query.id || "")) {
    url = api + "/predictions/" + req.query.id;
  } else if (req.method === "POST") {
    const { first, last, prompt, draft, aspect, resolution } = req.body || {};
    const image = (s) =>
      typeof s === "string" &&
      s.length < 2000000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s);
    if (
      !image(first) ||
      (last && !image(last)) ||
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 3000
    )
      return res.status(400).json({ error: "Kiểm tra lại ảnh và prompt." });
    const small = draft === true && !last;
    url =
      api +
      "/models/wan-video/" +
      (small ? "wan-2.2-5b-fast" : "wan-2.2-i2v-fast") +
      "/predictions";
    const input = {
      image: first,
      prompt,
      resolution: resolution === "720p" ? "720p" : "480p",
      num_frames: 81,
      frames_per_second: 16,
      go_fast: true,
    };
    if (small) input.aspect_ratio = aspect === "9:16" ? "9:16" : "16:9";
    if (last) input.last_image = last;
    body = JSON.stringify({ input });
  } else return res.status(400).json({ error: "Yêu cầu không hợp lệ." });
  try {
    const response = await fetch(url, {
      method: req.method,
      headers: { Authorization: token, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok)
      return res
        .status(response.status)
        .json({
          error:
            response.status === 401
              ? "Khóa Replicate không hợp lệ."
              : response.status === 402
                ? "Tài khoản Replicate cần có số dư."
                : "Replicate trả lỗi " + response.status,
        });
    res.json({
      id: data.id,
      status: data.status,
      output: data.output,
      error: data.error ? "Replicate không tạo được clip." : undefined,
    });
  } catch {
    res
      .status(502)
      .json({
        error:
          "Mất kết nối Replicate. Kiểm tra lịch sử tác vụ trước khi tạo lại.",
      });
  }
}
