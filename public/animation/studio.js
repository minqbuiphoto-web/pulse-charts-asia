import { playMovie, stopMovie } from "./timeline.js";
const $ = (id) => document.getElementById(id);
const report = (message) => {
  $("status").textContent = message;
};
const moods = {
  "Bình yên": "Subtle ambient motion, steady medium shot",
  "Cảm động": "A restrained gesture, very slow push in",
  "Lãng mạn": "Gentle gaze, slow sideways camera drift",
  "Căng thẳng": "Focused gaze, controlled low angle",
  "Cao trào": "One decisive movement, steady wide shot",
  "Cô đơn": "Still figure, slow pull back",
};
const option = (name, value = name) => new Option(name, value);
for (const mood of Object.keys(moods)) $("mood").add(option(mood));
function scene() {
  return {
    id: crypto.randomUUID(),
    mode: "one",
    duration: 23,
    mood: "Bình yên",
    strength: "Nhẹ",
    intent: "",
    prompt:
      "Preserve the original hand-drawn 2D linework and palette. Gentle breathing and subtle ambient motion. Steady camera.",
    model: "main",
    resolution: "480p",
    extend: "hold",
    takes: [],
    chosen: -1,
  };
}
function project() {
  return {
    id: crypto.randomUUID(),
    title: "MV hoạt hình mới",
    aspect: "16:9",
    scenes: [scene()],
  };
}
const db = await new Promise((ok, fail) => {
  const r = indexedDB.open("minqca-animation-2d", 1);
  r.onupgradeneeded = () =>
    r.result.createObjectStore("projects", { keyPath: "id" });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const records = await new Promise((ok) => {
  const r = db.transaction("projects").objectStore("projects").getAll();
  r.onsuccess = () => ok(r.result);
});
if (!records.length) records.push(project());
let p =
    records.find((x) => x.id === localStorage.animationProject) || records[0],
  i = 0,
  version = 0;
const current = () => p.scenes[i];
function save(record = p) {
  const n = ++version;
  const tx = db.transaction("projects", "readwrite");
  tx.objectStore("projects").put(record);
  $("saved").textContent = "Đang lưu…";
  tx.oncomplete = () => {
    if (version === n) $("saved").textContent = "Đã lưu trên máy";
  };
  tx.onabort = () => report("Lưu thất bại. Kiểm tra dung lượng trình duyệt.");
}
function projectMenu() {
  $("projects").replaceChildren(...records.map((x) => option(x.title, x.id)));
  $("projects").value = p.id;
}
let clipUrl = "",
  audioUrl = "";
function load() {
  stopMovie();
  $("movie").hidden = true;
  localStorage.animationProject = p.id;
  i = 0;
  projectMenu();
  $("title").value = p.title;
  $("aspect").value = p.aspect;
  URL.revokeObjectURL(audioUrl);
  audioUrl = p.audio ? URL.createObjectURL(p.audio) : "";
  if (audioUrl) $("audio").src = audioUrl;
  else $("audio").removeAttribute("src");
  draw();
}
function count() {
  return Math.max(1, Math.round((p.seconds || 210) / 23));
}
function summary() {
  const sum = p.scenes.reduce((n, s) => n + s.duration, 0);
  $("total").textContent =
    "Tổng " +
    sum.toFixed(1) +
    " giây · " +
    p.scenes.length +
    " cảnh" +
    (p.seconds ? " · Bài hát " + p.seconds.toFixed(1) + " giây" : "");
  $("suggest").textContent = p.seconds
    ? "Gợi ý " + count() + " cảnh theo độ dài bài."
    : "Nạp bài hát để gợi ý số cảnh.";
}
function price(s) {
  return s.model === "draft" && s.mode === "one"
    ? s.resolution === "480p"
      ? 0.0125
      : 0.025
    : s.resolution === "480p"
      ? 0.05
      : 0.11;
}
function draw() {
  const s = current();
  $("heading").textContent = "Cảnh " + (i + 1);
  $("list").replaceChildren(
    ...p.scenes.map((x, j) => {
      const b = document.createElement("button");
      b.textContent = "Cảnh " + (j + 1) + " · " + x.duration + "s";
      b.classList.toggle("selected", i === j);
      b.onclick = () => {
        i = j;
        draw();
      };
      return b;
    }),
  );
  for (const key of [
    "mode",
    "duration",
    "mood",
    "strength",
    "intent",
    "prompt",
    "model",
    "resolution",
    "extend",
  ])
    $(key).value = s[key];
  $("endbox").hidden = s.mode !== "two";
  $("model").disabled = s.mode === "two";
  $("img1").src = s.first || "";
  $("img2").src = s.last || "";
  $("analysis").textContent = s.analysis || "";
  $("generate").textContent = "Tạo clip ~5 giây · ước tính $" + price(s);
  $("generate").disabled =
    !!s.job ||
    submitting.has(s.id) ||
    !s.first ||
    (s.mode === "two" && !s.last);
  $("resume").hidden = !s.job;
  $("job").textContent = s.job ? "Tác vụ " + s.job : "";
  $("take").replaceChildren(
    ...s.takes.map((_, j) => option("Bản " + (j + 1), j)),
  );
  $("take").value = s.chosen;
  URL.revokeObjectURL(clipUrl);
  const blob = s.takes[s.chosen];
  clipUrl = blob ? URL.createObjectURL(blob) : "";
  $("clip").hidden = $("download").hidden = !blob;
  if (blob) {
    $("clip").src = clipUrl;
    $("download").href = clipUrl;
  } else $("clip").removeAttribute("src");
  summary();
}
function fresh() {
  save();
  draw();
}
for (const key of [
  "mode",
  "duration",
  "mood",
  "strength",
  "intent",
  "prompt",
  "model",
  "resolution",
  "extend",
])
  $(key).onchange = () => {
    const s = current();
    s[key] =
      key === "duration"
        ? Math.max(0.1, Number($(key).value) || 1)
        : $(key).value;
    if (s.mode === "two") s.model = "main";
    fresh();
  };
for (const key of ["intent", "prompt"])
  $(key).oninput = () => {
    current()[key] = $(key).value;
    save();
  };
$("title").oninput = () => {
  p.title = $("title").value;
  save();
  projectMenu();
};
$("aspect").onchange = () => {
  p.aspect = $("aspect").value;
  save();
};
$("projects").onchange = () => {
  p = records.find((x) => x.id === $("projects").value);
  load();
};
$("create").onclick = () => {
  p = project();
  records.push(p);
  load();
  save();
};
$("add").onclick = () => {
  i = p.scenes.push(scene()) - 1;
  fresh();
};
for (const [key, step] of [
  ["up", -1],
  ["down", 1],
])
  $(key).onclick = () => {
    const j = i + step;
    if (j < 0 || j >= p.scenes.length) return;
    [p.scenes[j], p.scenes[i]] = [p.scenes[i], p.scenes[j]];
    i = j;
    fresh();
  };
$("song").onchange = () => {
  if (!$("song").files[0]) return;
  p.audio = $("song").files[0];
  p.seconds = 0;
  load();
  save();
};
$("audio").onloadedmetadata = () => {
  if (Number.isFinite($("audio").duration)) {
    p.seconds = $("audio").duration;
    save();
    summary();
  }
};
$("plan").onclick = () => {
  if (!p.seconds) return report("Nạp nhạc trước.");
  while (p.scenes.length < count()) p.scenes.push(scene());
  const d = Math.floor((p.seconds * 10) / p.scenes.length) / 10;
  p.scenes.forEach(
    (s, j) =>
      (s.duration =
        j === p.scenes.length - 1 ? +(p.seconds - d * j).toFixed(2) : d),
  );
  fresh();
};
async function picture(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1120 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, bmp.width * scale);
  c.height = Math.max(1, bmp.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.83);
}
for (const key of ["first", "last"])
  $(key).onchange = async () => {
    const rec = p,
      s = current(),
      file = $(key).files[0];
    if (file) {
      s[key] = await picture(file);
      s.analysis = "";
      save(rec);
      draw();
      $(key).value = "";
    }
  };
$("compose").onclick = () => {
  const s = current();
  s.prompt = [
    "Preserve the illustrated 2D character design, clothing, outlines and flat colors.",
    moods[s.mood],
    s.intent,
    s.analysis,
    "Cường độ: " + s.strength,
    s.mode === "two" ? "End in the pose of the last frame." : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3000);
  fresh();
};
$("analyze").onclick = async () => {
  const rec = p,
    s = current(),
    key = $("vision").value.trim();
  if (!key || !s.first || (s.mode === "two" && !s.last))
    return report("Nhập khóa Gemini và chọn đủ ảnh.");
  const imgs = s.mode === "two" ? [s.first, s.last] : [s.first];
  const fingerprint = async () =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([
              s.mode === "two" ? [s.first, s.last] : [s.first],
              s.intent,
            ]),
          ),
        ),
      ),
    ).join(".");
  const signature = await fingerprint();
  if (s.analysis && s.signature === signature)
    return report("Đã có phân tích cho ảnh và ý đồ này.");
  $("analyze").disabled = true;
  try {
    const base = "https://generativelanguage.googleapis.com/v1beta/models";
    const headers = {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
    const models = await (await fetch(base, { headers })).json();
    const model = models.models
      ?.filter(
        (x) =>
          /flash-lite$/.test(x.name) &&
          x.supportedGenerationMethods.includes("generateContent"),
      )
      .at(-1);
    if (!model) throw Error("Khóa Gemini chưa truy cập được model Flash Lite.");
    const parts = [
      {
        text:
          "Phân tích tranh hoạt hình bằng tiếng Việt, tối đa 80 từ. Gợi ý cảm xúc, một hành động, chuyển động môi trường, góc máy, chi tiết cần giữ và rủi ro. Nếu có hai ảnh, đánh giá độ đồng nhất. Ý đồ tác giả: " +
          s.intent,
      },
      ...imgs.map((x) => ({
        inlineData: { mimeType: "image/jpeg", data: x.split(",")[1] },
      })),
    ];
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/" +
        model.name +
        ":generateContent",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ contents: [{ parts }] }),
      },
    );
    const data = await r.json();
    const answer = data.candidates?.[0]?.content?.parts
      ?.map((x) => x.text)
      .join(" ");
    if (!answer)
      throw Error("Gemini chưa trả về phân tích (" + r.status + ").");
    if (signature === (await fingerprint())) {
      s.analysis = answer;
      s.signature = signature;
      save(rec);
      draw();
    }
  } catch (e) {
    report(e.message);
  } finally {
    $("analyze").disabled = false;
  }
};
async function api(path, token, body) {
  const r = await fetch("/api/animation" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body && JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Lỗi kết nối");
  return data;
}
const polling = new Set(),
  submitting = new Set();
async function follow(rec, s, token) {
  if (polling.has(s.id)) return;
  polling.add(s.id);
  try {
    while (s.job) {
      const d = await api("?id=" + encodeURIComponent(s.job), token);
      if (["failed", "canceled"].includes(d.status)) {
        delete s.job;
        save(rec);
        draw();
        throw Error("Tác vụ đã dừng tại Replicate.");
      }
      if (d.status === "succeeded") {
        const r = await fetch(Array.isArray(d.output) ? d.output[0] : d.output);
        if (!r.ok) throw Error("Chưa tải được clip. Kiểm tra lại tác vụ.");
        s.takes.push(await r.blob());
        if (s.chosen < 0) s.chosen = 0;
        delete s.job;
        save(rec);
        draw();
        return report("Đã lưu phiên bản mới.");
      }
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
  } finally {
    polling.delete(s.id);
  }
}
async function generate(rec, s, token) {
  if (!token) return report("Nhập khóa Replicate trong mục Kết nối AI.");
  if (s.job || submitting.has(s.id)) return;
  submitting.add(s.id);
  $("generate").disabled = true;
  try {
    const d = await api("", token, {
      first: s.first,
      last: s.mode === "two" ? s.last : null,
      prompt: s.prompt,
      draft: s.model === "draft",
      resolution: s.resolution,
      aspect: p.aspect,
    });
    s.job = d.id;
    submitting.delete(s.id);
    save(rec);
    draw();
    await follow(rec, s, token);
  } finally {
    submitting.delete(s.id);
    draw();
  }
}
$("generate").onclick = () =>
  generate(p, current(), $("token").value.trim()).catch((e) =>
    report(e.message),
  );
$("resume").onclick = async () => {
  try {
    await follow(p, current(), $("token").value.trim());
  } catch (e) {
    report(e.message);
  }
};
$("take").onchange = () => {
  current().chosen = +$("take").value;
  fresh();
};
for (const key of ["preview", "render"])
  $(key).onclick = async () => {
    try {
      await playMovie(p, key === "render");
    } catch (e) {
      report(e.message);
    }
  };
$("stop").onclick = stopMovie;
load();
save();
$("remove").onclick = () => {
  const s = current();
  if (s.job || submitting.has(s.id)) return report("Cảnh đang được tạo clip.");
  if (confirm("Bỏ cảnh và các phiên bản của cảnh này?")) {
    p.scenes.splice(i, 1);
    if (!p.scenes.length) p.scenes.push(scene());
    i = Math.min(i, p.scenes.length - 1);
    fresh();
  }
};
$("continueClip").onclick = async () => {
  const rec = p,
    s = current(),
    blob = s.takes[s.chosen];
  if (!blob || s.duration <= 6)
    return report("Chọn clip đã duyệt và cảnh dài hơn 6 giây.");
  const u = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true;
    await new Promise((ok, fail) => {
      v.onloadeddata = ok;
      v.onerror = fail;
      v.src = u;
    });
    await new Promise((ok, fail) => {
      v.onseeked = ok;
      v.onerror = fail;
      v.currentTime = Math.max(0.001, v.duration - 0.07);
    });
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const next = {
      ...scene(),
      first: c.toDataURL("image/jpeg", 0.83),
      intent: s.intent,
      mood: s.mood,
      prompt: s.prompt,
      duration: Math.max(0.1, s.duration - v.duration),
    };
    s.duration = Math.round(v.duration * 10) / 10;
    s.extend = "hold";
    const index = rec.scenes.indexOf(s) + 1;
    rec.scenes.splice(index, 0, next);
    if (p === rec) i = index;
    save(rec);
    draw();
    report("Đã chuẩn bị đoạn nối. Duyệt prompt và giá trước khi tạo.");
  } catch {
    report("Không đọc được khung cuối của clip.");
  } finally {
    URL.revokeObjectURL(u);
  }
};
$("batch").onclick = async () => {
  const rec = p,
    token = $("token").value.trim();
  if (!token) return report("Nhập khóa Replicate.");
  const pending = rec.scenes.filter(
    (s) =>
      s.first &&
      !s.job &&
      !s.takes.length &&
      !submitting.has(s.id) &&
      (s.mode !== "two" || s.last),
  );
  if (!pending.length) return report("Chưa có cảnh đủ ảnh cần tạo.");
  const cost = pending.reduce((n, s) => n + price(s), 0);
  if (
    !confirm(
      "Tạo " +
        pending.length +
        " clip với tổng phí ước tính $" +
        cost.toFixed(4) +
        "?",
    )
  )
    return;
  const specs = pending.map((s) =>
    JSON.stringify([s.mode, s.model, s.resolution, s.first, s.last, s.prompt]),
  );
  $("batch").disabled = true;
  try {
    for (const [j, s] of pending.entries()) {
      if (
        p !== rec ||
        !rec.scenes.includes(s) ||
        specs[j] !==
          JSON.stringify([
            s.mode,
            s.model,
            s.resolution,
            s.first,
            s.last,
            s.prompt,
          ])
      )
        break;
      if (!s.takes.length) await generate(rec, s, token);
    }
  } catch (e) {
    report(e.message);
  } finally {
    $("batch").disabled = false;
  }
};
