import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual event handlers with a YouTube API double.
const source=readFileSync(new URL('../app/studio/page.tsx',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('  const togglePlayback='),source.indexOf('  const replayWorkingLine='));
const script=ts.transpileModule(handlers+'\nglobalThis.controls={playLine,togglePlayback,seekBy,restartSong};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup(times=[26.81,31.2,38.5],duration=100){
  const calls=[];
  const player={getDuration:()=>duration,getCurrentTime:()=>32,loadVideoById:options=>calls.push(['load',options]),seekTo:(...args)=>calls.push(['seek',...args]),playVideo:()=>calls.push(['play']),pauseVideo:()=>calls.push(['pause'])};
  const context={playerRef:{current:player},linePlaybackRef:{current:false},timeline:times.map(time=>({time,text:'test'})),song:{videoId:'test-video'},duration,currentTime:32,playerState:'PAUSED',setCurrentTime:()=>{},setFollowPlayback:()=>{}};
  vm.createContext(context);vm.runInContext(script,context);
  return {context,calls,controls:context.controls};
}
test('line replay passes its start and the next timestamp to the player',()=>{
  const {controls,calls}=setup();controls.playLine(0);
  assert.equal(JSON.stringify(calls),JSON.stringify([['load',{videoId:'test-video',startSeconds:26.81,endSeconds:31.2}]]));
});
test('clicking another line replaces the previous segment',()=>{
  const {controls,calls}=setup();controls.playLine(0);controls.playLine(1);
  assert.equal(calls[1][1].startSeconds,31.2);assert.equal(calls[1][1].endSeconds,38.5);
});
test('final line stops at video end; duplicate timestamps use the next distinct boundary',()=>{
  const {controls,calls}=setup([10,10,20],25);controls.playLine(0);controls.playLine(2);
  assert.equal(calls[0][1].endSeconds,20);assert.equal(calls[1][1].endSeconds,25);
});
test('normal playback clears the segment limit before resuming',()=>{
  const {controls,calls,context}=setup();controls.playLine(0);controls.togglePlayback();
  assert.equal(JSON.stringify(calls.slice(1)),JSON.stringify([['seek',32,true],['play']]));
  assert.equal(context.linePlaybackRef.current,false);
});
test('seek and restart leave segment mode; invalid ranges never play',()=>{
  const {controls,calls,context}=setup();controls.playLine(0);controls.seekBy(-5);
  assert.equal(context.linePlaybackRef.current,false);
  controls.playLine(1);controls.restartSong();assert.equal(context.linePlaybackRef.current,false);
  assert.equal(JSON.stringify(calls.slice(-2)),JSON.stringify([['seek',0,true],['play']]));
  const invalid=setup([110],100);invalid.controls.playLine(0);assert.equal(invalid.calls.length,0);
});
