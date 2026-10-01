'use client';
import { useEffect, useState } from 'react';
import './requests.css';

type SongRequest = { id: string; title: string; artist: string; createdAt: string };
export default function SongRequestPage() {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [request, setRequest] = useState<SongRequest | null>(null);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      setChecking(true); setReady(false); setError('');
      try {
        const response = await fetch('/api/song-requests?page=0', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Chưa kiểm tra được yêu cầu.');
        setReady(true);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Chưa kết nối được trang yêu cầu.');
      } finally { if (!controller.signal.aborted) setChecking(false); }
    }
    void check();
    return () => controller.abort();
  }, [retry]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || request) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/song-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, artist }), signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa gửi được yêu cầu.');
      setRequest(data.request);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }

  return <main className="song-request-page" lang="vi"><div className="song-request-layout"><section className="song-request-card">
    <span className="request-eyebrow">MINQCA STUDIO - GÓC YÊU CẦU</span>
    <h1>Một bài hát<br/><em>bạn muốn nghe.</em></h1>
    <p>Hãy yêu cầu từ từ để mình có thời gian hoàn thiện nhé. Xin cám ơn !</p>
    {checking ? <p role="status">Đang kiểm tra yêu cầu…</p> : request ? <div className="request-success" role="status">
      <h2>Đã nhận yêu cầu của bạn</h2><strong>{request.title}</strong><p>{request.artist}</p>
      <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time>
      <p>Cảm ơn bạn đã gửi yêu cầu!</p><button type="button" onClick={() => { setRequest(null); setTitle(''); setArtist(''); }}>Yêu cầu bài khác</button>
    </div> : <form onSubmit={submit}>
      <label htmlFor="requested-title">Tên bài hát<input id="requested-title" required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Tam Bái Hồng Trần Lương" disabled={busy}/></label>
      <label htmlFor="requested-artist">Ca sĩ<input id="requested-artist" required maxLength={120} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Ví dụ: Doãn Tích Miên" disabled={busy}/></label>
      <button disabled={!ready || busy || !title.trim() || !artist.trim()}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu bài hát'}</button>
      <small>Kiểm tra tên bài hát và ca sĩ trước khi gửi.</small>
    </form>}
    {error && <div role="alert" className="request-error">{error}{!ready && <button type="button" onClick={() => setRetry(value => value + 1)}>Thử kết nối lại</button>}</div>}
  </section><aside className="song-support-card" aria-labelledby="song-support-title">
    <h2 id="song-support-title">☕ Ủng hộ MinqCa một ly cà phê hay một ổ bánh mì nhé!</h2>
    <p>Nếu bạn yêu thích những gì MinqCa Studio đang làm, có thể góp một ly cà phê hay một ổ bánh mì để tiếp thêm chút năng lượng cho những sản phẩm tiếp theo. 🥐💜</p>
    <p>Link : <a href="https://drive.google.com/file/d/1UTIctBxYslFk1tBwspEBsqgMlLpwF90y/view?usp=drive_link" target="_blank" rel="noopener noreferrer">https://drive.google.com/file/d/1UTIctBxYslFk1tBwspEBsqgMlLpwF90y/view?usp=drive_link</a></p>
    <p><strong>Mọi sự ủng hộ đều rất đáng quý. Cảm ơn bạn thật nhiều!</strong></p>
  </aside></div></main>;
}
