'use client';
import { useCallback, useEffect, useState } from 'react';
import '../song-request/requests.css';
type RequestEntry = { id: string; title: string; artist: string; createdAt: string };
export default function SongRequestsBoard() {
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [adminKey, setAdminKey] = useState('');
  const [deleting, setDeleting] = useState('');
  const [notice, setNotice] = useState('');
  async function remove(item: RequestEntry) {
    if (!adminKey || deleting || !window.confirm(`Xóa yêu cầu “${item.title}” — ${item.artist} khỏi danh sách sau khi làm xong?`)) return;
    setDeleting(item.id); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/song-requests?id=${encodeURIComponent(item.id)}`, { method: 'DELETE', headers: { 'x-admin-key': adminKey }, signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa xóa được yêu cầu.');
      setNotice('Đã xóa yêu cầu khỏi danh sách.');
      if (requests.length === 1 && page > 0) setPage(value => value - 1);
      else setRefresh(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa xóa được yêu cầu.'); }
    finally { setDeleting(''); }
  }
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/song-requests?page=${page}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Chưa tải được yêu cầu.');
        setRequests(data.requests); setMore(data.hasMore); setError('');
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Chưa tải được yêu cầu.'); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    }
    setLoading(true); void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [page, refresh]);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/song-request/`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setError('Chưa sao chép được. Bạn có thể mở trang yêu cầu rồi sao chép địa chỉ.'); }
  }, []);
  return <section className="song-requests-board" aria-label="Yêu cầu bài hát">
    <h3>Yêu cầu bài hát</h3>
    <div className="song-request-toolbar"><div className="song-request-links"><button type="button" onClick={copy}>{copied ? 'Đã sao chép' : 'Sao chép link gửi yêu cầu'}</button><button type="button" onClick={() => setRefresh(value => value + 1)}>Làm mới</button></div><a className="song-request-open" href="/song-request/" target="_blank" rel="noopener noreferrer">Mở trang yêu cầu ↗</a></div>
    <p>Mọi người có thể yêu cầu nhiều bài · Tự cập nhật mỗi 30 giây.</p>
    <details className="song-request-admin"><summary>Quản lý yêu cầu (chỉ chủ trang)</summary><label>Mã quản trị<input type="password" value={adminKey} maxLength={512} autoComplete="off" onChange={event => setAdminKey(event.target.value)} placeholder="Nhập mã quản trị để xóa" /></label><p>Mã chỉ giữ trong tab này, không lưu trên trình duyệt.</p>{adminKey && <button type="button" onClick={() => setAdminKey('')}>Khóa quản lý</button>}</details>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Đang tải yêu cầu…</p> : requests.length === 0 && !error ? <p>Chưa có yêu cầu bài hát.</p> : requests.length > 0 && <div className="song-request-table"><table><thead><tr><th>Tên bài hát</th><th>Ca sĩ</th><th>Ngày yêu cầu</th><th>Thao tác</th></tr></thead><tbody>{requests.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.artist}</td><td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}<br/>{new Date(item.createdAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}</time></td><td><button type="button" className="song-request-delete" disabled={!adminKey || !!deleting} title={!adminKey ? 'Nhập mã trong Quản lý yêu cầu để xóa' : 'Xóa yêu cầu đã làm xong'} onClick={() => void remove(item)}>{deleting === item.id ? 'Đang xóa…' : 'Xóa'}</button></td></tr>)}</tbody></table></div>}
    {(page > 0 || more) && <div className="song-request-links"><button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Trang trước</button><span>{page + 1}</span><button disabled={!more || loading} onClick={() => setPage(value => value + 1)}>Trang sau</button></div>}
  </section>;
}
