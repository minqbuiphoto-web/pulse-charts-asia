import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/song-requests.js';

const id = 'a9a5e5ba-bc73-4ddc-8ee0-42dd248d2f94';
function response() { return { code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(body) { this.body = body; return this; } }; }
function input(body = { title: '  Bài hát  ', artist: 'Ca sĩ' }) { return { method: 'POST', headers: { 'x-request-browser': id, 'content-type': 'application/json', host: 'example.com', origin: 'https://example.com' }, body }; }
function store() {
  const browsers = new Map(), entries = [];
  return async command => {
    if (command[0] === 'EVAL') {
      assert.match(command[1], /HGET[\s\S]*HSET[\s\S]*LPUSH/);
      const key = command[5];
      if (browsers.has(key)) return [0, browsers.get(key)];
      browsers.set(key, command[6]); entries.unshift(command[6]); return [1, command[6]];
    }
    if (command[0] === 'HGET') return browsers.get(command[2]) || null;
    if (command[0] === 'LRANGE') return entries.slice(command[2], command[3] + 1);
    if (command[0] === 'LREM') { const index = entries.indexOf(command[3]); if (index < 0) return 0; entries.splice(index, 1); return 1; }
    throw new Error('Unexpected command');
  };
}
test('saves once across requests, returns original on retry and exposes only public fields', async () => {
  const handler = createHandler(store());
  const first = response(); await handler(input(), first);
  assert.equal(first.code, 201); assert.equal(first.body.request.title, 'Bài hát');
  assert.ok(Number.isFinite(Date.parse(first.body.request.createdAt)));
  const second = response(); await handler(input({ title: 'Another song', artist: 'Different artist' }), second);
  assert.equal(second.code, 200); assert.equal(second.body.alreadySubmitted, true); assert.deepEqual(second.body.request, first.body.request);
  const list = response(); await handler({ method: 'GET', query: {} }, list);
  assert.equal(list.body.requests.length, 1); assert.deepEqual(Object.keys(list.body.requests[0]).sort(), ['artist','createdAt','id','title']);
  const mine = response(); await handler({ method: 'GET', query: { view: 'mine' }, headers: { 'x-request-browser': id } }, mine);
  assert.deepEqual(mine.body.request, first.body.request);
});
test('saved cookie keeps one-request limit if client identifier changes', async () => {
  const handler = createHandler(store()); const first = response(); await handler(input(), first);
  const req = input(); req.headers['x-request-browser'] = '06d9bbed-8492-4432-8813-47f78172ab44'; req.headers.cookie = `pulse_song_request=${id}`;
  const again = response(); await handler(req, again); assert.equal(again.body.alreadySubmitted, true);
});
test('rejects empty, oversized and invalid input before storage', async () => {
  const handler = createHandler(async () => { throw new Error('Must not reach storage'); });
  for (const body of [{title:' ',artist:'A'}, {title:'A',artist:''}, {title:'x'.repeat(161),artist:'A'}, {title:['A'],artist:'A'}]) {
    const result=response(); await handler(input(body),result); assert.equal(result.code,400);
  }
  const crossOrigin=input(); crossOrigin.headers.origin='https://other.example'; const cross=response(); await handler(crossOrigin,cross); assert.equal(cross.code,403);
  const invalidId=input(); invalidId.headers['x-request-browser']='bad'; const invalid=response(); await handler(invalidId,invalid); assert.equal(invalid.code,400);
});
test('storage errors never report success or set submission cookie', async () => {
  const handler=createHandler(async()=>{throw new Error('offline');}); const result=response(); await handler(input(),result);
  assert.equal(result.code,503); assert.equal(result.headers['Set-Cookie'],undefined); assert.equal(result.body.request,undefined);
});
test('paginates without disclosing browser identifiers', async()=>{
  const handler=createHandler(async command=>{assert.deepEqual(command,['LRANGE','pulse:song-requests:v1:list',50,100]);return Array.from({length:51},(_,i)=>JSON.stringify({id:String(i),title:'A',artist:'B',createdAt:new Date().toISOString()}));});
  const result=response();await handler({method:'GET',query:{page:'1'}},result);assert.equal(result.body.requests.length,50);assert.equal(result.body.hasMore,true);
});

const adminKey = 'test-only-admin-key-with-32-characters';
function deletion(requestId, key = adminKey) { return { method: 'DELETE', query: { id: requestId }, headers: { 'x-admin-key': key, host: 'example.com', origin: 'https://example.com' } }; }
test('deletion requires configured admin key and rejects unauthorized callers before storage', async () => {
  const noStorage = async () => { throw new Error('Must not reach storage'); };
  for (const key of ['', 'wrong']) {
    const result = response(); await createHandler(noStorage, () => adminKey)(deletion(id, key), result);
    assert.equal(result.code, 401);
  }
  const missing = deletion(id); delete missing.headers['x-admin-key'];
  const denied = response(); await createHandler(noStorage, () => adminKey)(missing, denied); assert.equal(denied.code, 401);
  const unconfigured = response(); await createHandler(noStorage, () => undefined)(deletion(id), unconfigured); assert.equal(unconfigured.code, 503);
  const cross = deletion(id); cross.headers.origin = 'https://other.example';
  const forbidden = response(); await createHandler(noStorage, () => adminKey)(cross, forbidden); assert.equal(forbidden.code, 403);
  const invalid = response(); await createHandler(noStorage, () => adminKey)(deletion('invalid'), invalid); assert.equal(invalid.code, 400);
});
test('admin deletion removes only selected row, keeps submission limit and is idempotent', async () => {
  const handler = createHandler(store(), () => adminKey);
  const first = response(); await handler(input(), first);
  const otherInput = input({ title: 'Other', artist: 'Artist' }); otherInput.headers['x-request-browser'] = '06d9bbed-8492-4432-8813-47f78172ab44';
  const other = response(); await handler(otherInput, other);
  for (let i = 0; i < 2; i++) { const removed = response(); await handler(deletion(first.body.request.id), removed); assert.equal(removed.code, 200); }
  const list = response(); await handler({ method: 'GET', query: {} }, list); assert.deepEqual(list.body.requests, [other.body.request]);
  const again = response(); await handler(input(), again); assert.equal(again.body.alreadySubmitted, true);
  const after = response(); await handler({ method: 'GET', query: {} }, after); assert.equal(after.body.requests.length, 1);
});
