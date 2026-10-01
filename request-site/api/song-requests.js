import { randomUUID } from 'node:crypto';

const LIST = 'pulse:song-requests:v1:list';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
  }
  try {
    if (req.method === 'GET') {
      await redis(['PING']);
      return res.status(200).json({ ready: true });
    }
    if (req.headers?.origin && new URL(req.headers.origin).host !== req.headers?.host) return res.status(403).json({ error: 'Hãy gửi yêu cầu từ trang chính thức.' });
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
    await redis(['LPUSH', LIST, JSON.stringify(entry)]);
    return res.status(201).json({ request: entry });
  } catch (error) {
    return res.status(503).json({ error: error?.code === 'NOT_CONFIGURED' ? 'Trang nhận yêu cầu chưa được mở. Vui lòng quay lại sau.' : 'Chưa kết nối được kho yêu cầu. Vui lòng thử lại.' });
  }
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
