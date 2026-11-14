import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../src/components/common/wordCloudLayout.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(module, module.exports);
const { placeCloudWords } = module.exports;
let layouts = 0;
const began = performance.now();
function verify(layout, width, count) {
  assert.equal(layout.words.length, count);
  if (!count) return;
  assert.equal(layout.words[0].x, 0);
  assert.equal(layout.words[0].y, 0);
  for (let i=0;i<count;i++) {
    const a=layout.words[i];
    assert(Number.isFinite(a.x) && Number.isFinite(a.y));
    assert(Math.abs(a.x)+a.width/2 <= width/2);
    assert(Math.abs(a.y)+a.height/2 <= layout.height/2);
    for(let j=i+1;j<count;j++) {
      const b=layout.words[j];
      assert(Math.abs(a.x-b.x) >= (a.width+b.width)/2 || Math.abs(a.y-b.y) >= (a.height+b.height)/2, `overlap ${a.text}/${b.text}`);
    }
  }
  layouts++;
}
for (const width of [286,356,700,1000,1400]) {
  const words=Array.from({length:200},(_,n)=>({text:`생각${n}`,width:Math.min(width-48,45+(n*37)%210),height:n%13===0?150:44+(n%4)*9}));
  const full=placeCloudWords(words,width,360);
  verify(full,width,200);
  const initial=placeCloudWords(words.slice(0,12),width,360);
  const appended=placeCloudWords(words.slice(0,13),width,360,new Map(initial.words.map(w=>[w.text,w])));
  verify(appended,width,13);
  assert.deepEqual(appended.words.slice(0,12),initial.words,'an appended response preserves every existing position');
  const larger=words.map((w,n)=>n<8?{...w,width:Math.min(width-48,w.width*1.7),height:w.height*1.5}:w);
  verify(placeCloudWords(larger,width,360,new Map(full.words.map(w=>[w.text,w]))),width,200);
  const sentences=words.map(w=>({...w,width:width-48,height:180}));
  verify(placeCloudWords(sentences,width,360),width,200);
}
const crowded = Array.from({length:60},(_,n)=>({text:`생각${String(n).padStart(2,'0')}`,width:80,height:44}));
const before = placeCloudWords(crowded,768,360);
const after = placeCloudWords(crowded.map((w,n)=>n===10?{...w,width:250,height:90}:w),768,360,new Map(before.words.map(w=>[w.text,w])));
verify(after,768,60);
assert.deepEqual(after.words.filter((_,i)=>i!==10),before.words.filter((_,i)=>i!==10),'growing one noncentral word preserves all 59 unaffected positions');
console.log(JSON.stringify({passed:true,layouts,maxWords:200,elapsedMs:Math.round(performance.now()-began),checks:'center, collision-free, all responses, stable append, growth and full-width sentences; no network'}));
