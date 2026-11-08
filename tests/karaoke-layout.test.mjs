import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../app/mv-studio/karaoke-layout.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {karaokeSchedule,karaokeOpacity}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('holds the completed line until the other starts, then fades and replaces it',()=>{
 const rows=karaokeSchedule([1,3,5,7].map(time=>({time,end:time+2})),12);
 assert.equal(karaokeOpacity(rows[0],3.1),1);
 assert.ok(karaokeOpacity(rows[0],3.3)<1);
 assert.equal(rows[2].showStart,rows[0].showEnd);
 assert.ok(karaokeOpacity(rows[2],3.6)>0&&karaokeOpacity(rows[2],3.6)<1);
 assert.equal(karaokeOpacity(rows[2],4),1);
});
test('rapid rows never overlap their replacement and stay inside the output',()=>{
 const rows=karaokeSchedule(Array.from({length:10},(_,i)=>({time:i*.1,end:(i+1)*.1})),1);
 for(let i=0;i<rows.length;i++){
  assert.ok(rows[i].showEnd<=1);
  if(i>=2)assert.ok(rows[i].showStart>=rows[i-2].showEnd);
 }
 assert.deepEqual(karaokeSchedule([]),[]);
});
