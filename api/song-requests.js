import { createHash, randomUUID } from 'node:crypto';

const PREFIX = 'pulse:song-requests:v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ADD_ONCE = `
local old = redis.call('HGET', KEYS[1], ARGV[1])
if old then return {0, old} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[2])
return {1, ARGV[2]}
`;

export function createHandler(command) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
    }
    try {
      if (req.method === 'GET' && req.query?.view !== 'mine') {
        const page = Number(req.query?.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > 10000) return res.status(400).json({ error: 'Trang không hợp lệ.' });
        const entries = await command(['LRANGE', `${PREFIX}:list`, page * 50, page * 50 + 50]);
        return res.status(200).json({ requests: entries.slice(0, 50).map(value => JSON.parse(value)), hasMore: entries.length > 50 });
      }
      const cookieId = /(?:^|;\s*)pulse_song_request=([^;]+)/.exec(req.headers?.cookie || '')?.[1];
      const browserId = UUID.test(cookieId || '') ? cookieId : req.headers?.['x-request-browser'];
      if (typeof browserId !== 'string' || !UUID.test(browserId)) return res.status(400).json({ error: 'Không nhận diện được trình duyệt. Hãy tải lại trang.' });
      const browserHash = createHash('sha256').update(browserId).digest('hex');
      if (req.method === 'GET') {
        const entry = await command(['HGET', `${PREFIX}:browsers`, browserHash]);
        return res.status(200).json({ request: entry ? JSON.parse(entry) : null });
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
      const [created, saved] = await command(['EVAL', ADD_ONCE, 2, `${PREFIX}:browsers`, `${PREFIX}:list`, browserHash, JSON.stringify(entry)]);
      res.setHeader('Set-Cookie', `pulse_song_request=${browserId}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`);
      return res.status(created ? 201 : 200).json({ request: JSON.parse(saved), alreadySubmitted: !created });
    } catch (error) {
      return res.status(503).json({ error: error?.code === 'NOT_CONFIGURED' ? 'Trang nhận yêu cầu chưa được mở. Vui lòng quay lại sau.' : 'Chưa kết nối được kho yêu cầu. Vui lòng thử lại; yêu cầu của bạn sẽ không bị gửi trùng.' });
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
