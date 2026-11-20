const $ = (id) => document.getElementById(id);
let running = false,
  stopped = false,
  movieUrl = "";
export function stopMovie() {
  stopped = true;
}
function ready(el, event, url) {
  return new Promise((ok, fail) => {
    el.addEventListener(event, ok, { once: true });
    el.addEventListener(
      "error",
      () => fail(Error("Không đọc được ảnh, clip hoặc nhạc.")),
      { once: true },
    );
    el.src = url;
  });
}
export async function playMovie(project, exporting) {
  if (running) return;
  const scenes = project.scenes.map((s) => ({ ...s, blob: s.takes[s.chosen] }));
  if (scenes.some((s) => !s.blob && !s.first))
    throw Error("Mỗi cảnh cần có ảnh đầu hoặc clip.");
  const mime = [
    "video/mp4;codecs=vp9,opus",
    "video/mp4;codecs=avc1.42001E,mp4a.40.2",
    "video/mp4",
  ].find((m) => window.MediaRecorder?.isTypeSupported(m));
  if (exporting && !mime)
    throw Error(
      "Trình duyệt chưa hỗ trợ ghi MP4. Hãy mở bằng Chrome hoặc Edge mới.",
    );
  running = true;
  stopped = false;
  const urls = [],
    media = [];
  let context, recorder, stream, song;
  function url(blob) {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }
  try {
    const canvas = $("canvas");
    canvas.hidden = false;
    const vertical = project.aspect === "9:16";
    canvas.width = vertical ? 720 : 1280;
    canvas.height = vertical ? 1280 : 720;
    const ctx = canvas.getContext("2d");
    if (project.audio) {
      context = new AudioContext();
      await context.resume();
      song = new Audio();
      await ready(song, "canplay", url(project.audio));
    }
    for (const s of scenes) {
      const el = s.blob ? document.createElement("video") : new Image();
      if (s.blob) {
        el.muted = true;
        el.playsInline = true;
        el.loop = s.extend === "loop";
      }
      await ready(
        el,
        s.blob ? "canplay" : "load",
        s.blob ? url(s.blob) : s.first,
      );
      media.push(el);
    }
    const duration = scenes.reduce((n, s) => n + s.duration, 0);
    const chunks = [];
    if (exporting) stream = canvas.captureStream(25);
    if (song) {
      const source = context.createMediaElementSource(song);
      if (exporting) {
        const dest = context.createMediaStreamDestination();
        source.connect(dest);
        stream.addTrack(dest.stream.getAudioTracks()[0]);
      } else source.connect(context.destination);
    }
    let finished;
    if (exporting) {
      recorder = new MediaRecorder(stream, { mimeType: mime });
      finished = new Promise((ok, fail) => {
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = ok;
        recorder.onerror = () => fail(Error("Ghi MP4 thất bại."));
      });
    }
    let index = 0,
      until = scenes[0].duration;
    function paint() {
      const el = media[index];
      const w = el.videoWidth || el.naturalWidth,
        h = el.videoHeight || el.naturalHeight;
      const scale = Math.min(canvas.width / w, canvas.height / h);
      ctx.fillStyle = "#101119";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        el,
        (canvas.width - w * scale) / 2,
        (canvas.height - h * scale) / 2,
        w * scale,
        h * scale,
      );
    }
    paint();
    if (stopped) return;
    recorder?.start(1000);
    if (song) await song.play();
    if (scenes[0].blob) await media[0].play();
    const start = performance.now();
    while (!stopped) {
      const time = (performance.now() - start) / 1000;
      if (time >= duration) break;
      while (time >= until && index < scenes.length - 1) {
        media[index].pause?.();
        index++;
        until += scenes[index].duration;
        if (scenes[index].blob) await media[index].play();
      }
      paint();
      stream?.getVideoTracks()[0]?.requestFrame?.();
      $("progress").textContent =
        (exporting ? "Đang xuất " : "Xem thử ") +
        Math.floor(time) +
        " / " +
        Math.ceil(duration) +
        " giây";
      await new Promise((ok) => setTimeout(ok, 40));
    }
    if (recorder) {
      recorder.stop();
      await finished;
      if (!stopped) {
        URL.revokeObjectURL(movieUrl);
        const result = new Blob(chunks, { type: "video/mp4" });
        if (result.size < 128)
          throw Error(
            "Trình duyệt chưa ghi được hình. Vui lòng xuất lại bằng Chrome.",
          );
        movieUrl = URL.createObjectURL(result);
        $("movie").href = movieUrl;
        $("movie").hidden = false;
        $("movie").click();
      }
    }
    $("progress").textContent = stopped ? "Đã dừng" : "Hoàn tất";
  } finally {
    song?.pause();
    for (const el of media) el.pause?.();
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach((t) => t.stop());
    await context?.close();
    urls.forEach((u) => URL.revokeObjectURL(u));
    running = false;
  }
}
