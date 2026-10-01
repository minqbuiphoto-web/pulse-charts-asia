'use client';
import { useEffect, useState } from 'react';
import './requests.css';

type SongRequest = { id: string; title: string; artist: string; createdAt: string };
const KEY = 'pulse-song-request-browser-v1';
export default function SongRequestPage() {
  const [browserId, setBrowserId] = useState('');
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
        let id = localStorage.getItem(KEY);
        if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
        setBrowserId(id);
        const response = await fetch('/api/song-requests?view=mine', { headers: { 'x-request-browser': id }, cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Chưa kiểm tra được yêu cầu.');
        setRequest(data.request); setReady(true);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Hãy cho phép lưu dữ liệu trình duyệt để gửi yêu cầu.');
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
      const response = await fetch('/api/song-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-browser': browserId }, body: JSON.stringify({ title, artist }), signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa gửi được yêu cầu.');
      setRequest(data.request);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }

  return <main className="song-request-page" lang="vi"><div className="song-request-layout"><section className="song-request-card">
    <span className="request-eyebrow">PULSE · GÓC YÊU CẦU</span>
    <h1>Một bài hát<br/><em>bạn muốn nghe.</em></h1>
    <p>Nhập tên bài hát và ca sĩ. Mỗi trình duyệt được gửi một yêu cầu.</p>
    {checking ? <p role="status">Đang kiểm tra yêu cầu…</p> : request ? <div className="request-success" role="status">
      <h2>Đã nhận yêu cầu của bạn</h2><strong>{request.title}</strong><p>{request.artist}</p>
      <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time>
      <p>Trình duyệt này đã gửi một bài. Cảm ơn bạn!</p>
    </div> : <form onSubmit={submit}>
      <label htmlFor="requested-title">Tên bài hát<input id="requested-title" required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Có chàng trai viết lên cây" disabled={busy}/></label>
      <label htmlFor="requested-artist">Ca sĩ<input id="requested-artist" required maxLength={120} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Ví dụ: Phan Mạnh Quỳnh" disabled={busy}/></label>
      <button disabled={!ready || busy || !title.trim() || !artist.trim()}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu bài hát'}</button>
      <small>Kiểm tra thông tin trước khi gửi. Sau khi gửi thành công, bạn không thể gửi thêm trên trình duyệt này.</small>
    </form>}
    {error && <div role="alert" className="request-error">{error}{!ready && <button type="button" onClick={() => setRetry(value => value + 1)}>Thử kết nối lại</button>}</div>}
  </section><aside className="song-support-card" aria-labelledby="song-support-title">
    <h2 id="song-support-title">☕ Mời MinqCa một ly cà phê nhé!</h2>
    <p>Nếu bạn yêu thích những gì MinqCa Studio đang làm, có thể góp một ly cà phê hay một ổ bánh mì để tiếp thêm chút năng lượng cho những sản phẩm tiếp theo. 🥐💜</p>
    <p>Link : <a href="https://drive.google.com/file/d/1UTIctBxYslFk1tBwspEBsqgMlLpwF90y/view?usp=drive_link" target="_blank" rel="noopener noreferrer">https://drive.google.com/file/d/1UTIctBxYslFk1tBwspEBsqgMlLpwF90y/view?usp=drive_link</a></p>
    <p><strong>Mọi sự ủng hộ đều rất đáng quý. Cảm ơn bạn thật nhiều!</strong></p>
  </aside></div></main>;
}
