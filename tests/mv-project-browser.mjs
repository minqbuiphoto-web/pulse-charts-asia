// Run after npm run build. Uses an isolated browser profile, never the user's projects.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('out');
const server=createServer(async(req,res)=>{
 try{
  let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path.endsWith('/'))path+='index.html';
  const file=resolve(root,'.'+path);if(!file.startsWith(root))throw new Error('path');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.statusCode=404;res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('http://127.0.0.1:8765/**',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/mv-studio/`);
 const saved=()=>page.waitForFunction(()=>/Đã (tự )?lưu ·/.test(document.querySelector('.project-dock')?.textContent||''));
 await saved();
 await page.getByLabel('Tên dự án',{exact:true}).fill('Reload regression');
 const lyrics=page.getByPlaceholder('Dán lời Việt ở đây · mỗi câu một dòng');
 await lyrics.fill('Câu mới nhất\nCâu thứ hai');
 await page.getByRole('button',{name:'LƯU NGAY',exact:true}).click();await saved();
 await page.reload();await saved();
 assert.equal(await lyrics.inputValue(),'Câu mới nhất\nCâu thứ hai');
 assert.equal(await page.getByLabel('Tên dự án',{exact:true}).inputValue(),'Reload regression');
 await lyrics.fill('Tự lưu không bấm nút');await saved();await page.reload();await saved();
 assert.equal(await lyrics.inputValue(),'Tự lưu không bấm nút');
 const upload=page.locator('.thumbnail-step input[type=file]');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
 await upload.setInputFiles({name:'same.png',mimeType:'image/png',buffer:png});await saved();
 const changed=Buffer.concat([png,Buffer.from('replacement')]);
 await upload.setInputFiles({name:'same.png',mimeType:'image/png',buffer:changed});await saved();
 const record=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulse-mv-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const item=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get(localStorage.getItem('pulse-mv-last-project'));r.onsuccess=()=>resolve(r.result)});
  db.close();return {size:item.thumbnailBlob.size,lyrics:item.vietnamese};
 });
 assert.equal(record.size,changed.length);await page.reload();await saved();
 assert.equal(await page.locator('.thumbnail-step img').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS: manual save + reload, autosave + reload, same-name media replacement persisted in real IndexedDB; no page errors');
}finally{await browser.close();server.close()}
