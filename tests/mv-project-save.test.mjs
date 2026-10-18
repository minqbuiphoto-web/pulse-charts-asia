import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../app/mv-studio/page.tsx',import.meta.url),'utf8');
const save=source.slice(source.indexOf('const saveCurrentProject='),source.indexOf('const restoreWorkspace='));
function harness(write=async()=>{}){
 const state={Promise,Date,DOMException,projectId:'test',projectReady:true,projectName:'Test',statuses:[],records:[],list:[]};
 for(const name of ['mode','videoFormat','verticalThumbnailName','audioName','thumbnailName','original','literal','vietnamese','activePreset','lyricShadow','style','story','motion','atmosphere','trimVideoName','trimThumbnailName','trimResultName','renderedVideoName'])state[name]='';
 for(const name of ['verticalMotionClipNames','verticalMotionEffects','motionClipNames','motionEffects','rows'])state[name]=[];
 for(const name of ['textStyles','textPositions'])state[name]={};
 for(const name of ['introDuration','trimDuration','trimStart','trimEnd','trimThumbnailDuration'])state[name]=0;
 state.motionEnabled=false;
 for(const name of [...save.matchAll(/\b(\w+Ref)\.current/g)].map(match=>match[1]))state[name]={current:null};
 for(const name of ['verticalImageFilesRef','verticalMotionClipFilesRef','imageFilesRef','motionClipFilesRef'])state[name].current=[];
 state.saveQueueRef.current=Promise.resolve(true);state.saveRevisionRef.current=0;state.savedRevisionRef.current=0;
 state.setProjectStatus=value=>state.statuses.push(value);
 state.setProjectList=update=>state.list=update(state.list);
 state.putMvProject=async record=>{await write(record);state.records.push(record)};
 vm.createContext(state);
 vm.runInContext(ts.transpileModule(save+';globalThis.save=saveCurrentProject',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,state);
 return state;
}
test('manual save captures latest lyrics, timeline and media, and waits for storage',async()=>{
 let release;const h=harness(()=>new Promise(resolve=>{release=resolve}));
 h.vietnamese='Lời vừa sửa';h.rows=[{time:1,end:3,vietnamese:h.vietnamese}];
 const blob=new Blob(['new file']);h.audioFileRef.current=blob;h.renderedVideoBlobRef.current=blob;
 const saving=h.save(false);await Promise.resolve();
 assert.equal(h.records.length,0);assert.equal(h.savedRevisionRef.current,0);
 release();assert.equal(await saving,true);
 assert.equal(h.records[0].vietnamese,'Lời vừa sửa');assert.equal(h.records[0].audioBlob,blob);
 assert.equal(h.records[0].workspace.renderedVideoBlob,blob);
 assert.match(h.statuses.at(-1),/^Đã lưu/);
});
test('serial saves never let an older snapshot overwrite a newer edit',async()=>{
 const releases=[];const h=harness(()=>new Promise(resolve=>releases.push(resolve)));
 h.vietnamese='old';const first=h.save(true);h.vietnamese='latest';const second=h.save(false);
 await Promise.resolve();assert.equal(releases.length,1);releases.shift()();await first;
 await Promise.resolve();assert.equal(releases.length,1);releases.shift()();await second;
 assert.deepEqual(h.records.map(record=>record.vietnamese),['old','latest']);
 assert.equal(h.savedRevisionRef.current,h.saveRevisionRef.current);
});
test('failed saves remain dirty, report failure, and allow retry',async()=>{
 let fail=true;const h=harness(async()=>{if(fail)throw new DOMException('full','QuotaExceededError')});
 assert.equal(await h.save(),false);assert.equal(h.saveFailedRef.current,true);
 assert.notEqual(h.savedRevisionRef.current,h.saveRevisionRef.current);assert.match(h.statuses.at(-1),/Chưa lưu/);
 fail=false;assert.equal(await h.save(),true);assert.equal(h.saveFailedRef.current,false);
});
test('restores trim boundaries and completed videos; supports legacy projects',()=>{
 const restore=source.slice(source.indexOf('const restoreWorkspace='),source.indexOf('const restoreProject='));
 const h={Blob,File,URL,trimVideoUrl:'',trimThumbnailUrl:'',trimResultUrl:'',renderedVideoUrl:''};
 for(const match of restore.matchAll(/\b(\w+Ref)\.current/g))h[match[1]]={current:null};
 for(const match of restore.matchAll(/\b(set\w+)\(/g))h[match[1]]=value=>h[match[1]+'Value']=value;
 vm.createContext(h);vm.runInContext(ts.transpileModule(restore+';globalThis.restore=restoreWorkspace',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,h);
 const blob=new Blob(['video'],{type:'video/mp4'});
 h.restore({workspace:{trimVideoBlob:blob,trimVideoName:'mv.mp4',trimStart:5,trimEnd:12,trimDuration:20,renderedVideoBlob:blob,renderedVideoName:'done.mp4'}});
 assert.equal(h.setTrimStartValue,5);assert.equal(h.setTrimEndValue,12);
 assert.equal(h.trimVideoFileRef.current.name,'mv.mp4');assert.equal(h.renderedVideoBlobRef.current,blob);
 URL.revokeObjectURL(h.setTrimVideoUrlValue);URL.revokeObjectURL(h.setRenderedVideoUrlValue);
 h.restore({});assert.equal(h.setTrimStartValue,0);assert.equal(h.renderedVideoBlobRef.current,null);
});
test('autosave watches file identity, guards reload, and checkpoints each clip',()=>{
 assert.match(source,/useLayoutEffect\(\(\)=>\{if\(projectReady&&projectId\)void saveCurrentProject\(true\)/);
 assert.doesNotMatch(source,/setTimeout\(\(\)=>void saveCurrentProject/);
 assert.match(source,/addEventListener\("beforeunload",warn\)/);
 assert.match(source,/thumbnailName,thumbnailUrl/);assert.match(source,/audioName,audioUrl/);
 assert.match(source,/verticalMotionClipFilesRef.current=\[\.\.\.nextBlobs\]/);
 assert.match(source,/durability:"strict"/);assert.match(source,/transaction.onabort/);
});
