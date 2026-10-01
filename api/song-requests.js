import { randomUUID } from 'node:crypto';

const PREFIX = 'pulse:song-requests:v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function createHandler(command) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
    }
    try {
      if (req.method === 'DELETE') {
        if (req.headers?.origin && new URL(req.headers.origin).host !== req.headers?.host) return res.status(403).json({ error: 'Hãy thao tác từ trang chính thức.' });
        const id = req.query?.id;
        if (typeof id !== 'string' || !UUID.test(id)) return res.status(400).json({ error: 'Yêu cầu không hợp lệ.' });
        // Remove the completed request from the visible queue.
        for (let offset = 0; ; offset += 100) {
          const entries = await command(['LRANGE', `${PREFIX}:list`, offset, offset + 99]);
          const entry = entries.find(value => JSON.parse(value).id === id);
          if (entry) { await command(['LREM', `${PREFIX}:list`, 1, entry]); break; }
          if (entries.length < 100) break;
        }
        return res.status(200).json({ deleted: true });
      }
      if (req.method === 'GET') {
        const page = Number(req.query?.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > 10000) return res.status(400).json({ error: 'Trang không hợp lệ.' });
        const entries = await command(['LRANGE', `${PREFIX}:list`, page * 50, page * 50 + 50]);
        return res.status(200).json({ requests: entries.slice(0, 50).map(value => JSON.parse(value)), hasMore: entries.length > 50 });
      }
      const origin = req.headers?.origin;
      if (origin && new URL(origin).host !== req.headers?.host) return res.status(403).json({ error: 'Hãy gửi yêu cầu từ trang chính thức.' });
      if (!req.headers?.['content-type']?.startsWith('application/json')) return res.status(415).json({ error: 'Dữ liệu gửi không hợp lệ.' });
      if (Number(req.headers?.['content-length'] || 0) > 4096) return res.status(413).json({ error: 'Nội dung quá dài.' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' }); } }
      const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      const title = clean(body?.title), artist = clean(body?.artist);
      if (!title || !artist || title.length > 160 || artist.length > 120 || /[\u0000-\u001f\u007f]/.test(title + artist)) {
        return res.status(400).json({ error: 'Nhập tên bài hát (tối đa 160 ký tự) và ca sĩ (tối đa 120 ký tự).' });
      }
      const entry = { id: randomUUID(), title, artist, createdAt: new Date().toISOString() };
      await command(['LPUSH', `${PREFIX}:list`, JSON.stringify(entry)]);
      return res.status(201).json({ request: entry });
    } catch (error) {
      return res.status(503).json({ error: error?.code === 'NOT_CONFIGURED' ? 'Trang nhận yêu cầu chưa được mở. Vui lòng quay lại sau.' : 'Chưa kết nối được kho yêu cầu. Vui lòng thử lại.' });
    }
  };
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw Object.assign(new Error('Missing request storage'), { code: 'NOT_CONFIGURED' });
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Storage unavailable');
  const data = await response.json();
  if (data.error) throw new Error('Storage command failed');
  return data.result;
}
export default createHandler(redis);
