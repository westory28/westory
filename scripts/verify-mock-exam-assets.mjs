import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..');
const built = await build({entryPoints:[path.join(root,'src/lib/mockExamAssets.ts')],bundle:true,write:false,format:'esm',platform:'node'});
const {collectMockExamAssets,createMockExamAssetLoader,MockExamAssetError}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

function environment({failImage='',failFonts=false,delay=3,decodeDelay=5,timeoutMs=1000,concurrency=4}={}){
 const requests=[],decodes=[],removed=[];let active=0,maxActive=0;
 class Image {
  complete=false;naturalWidth=0;onload=null;onerror=null;_source='';
  set src(source){this._source=source;requests.push(source);active++;maxActive=Math.max(maxActive,active);setTimeout(()=>{active--;if(!this._source)return;if(source===failImage)this.onerror?.();else{this.complete=true;this.naturalWidth=64;this.onload?.();}},delay);}
  get src(){return this._source;}
  async decode(){await sleep(decodeDelay);decodes.push(this._source);}
  removeAttribute(){removed.push(this._source);this._source='';}
 }
 const fontLoads=[];
 return {createImage:()=>new Image(),fonts:{async load(font,characters){fontLoads.push({font,characters});await sleep(delay);if(failFonts)throw new Error('font failed');return [{}];}},timeoutMs,concurrency,requests,decodes,removed,fontLoads,get maxActive(){return maxActive;}};
}

const manifest=collectMockExamAssets([{question:'질문',passage:'자료',examplePassage:'보기',image:'/same.png',choiceOptionImages:['/same.png','/choice.png'],passageSet:{id:'set',instruction:'공통 지문',passage:'본문',image:'/set.png'},matchingRightOptions:[{right:'연결',rightImage:'/right.png'}],answer:'NEVER_INCLUDE_ANSWER',explanation:'NEVER_INCLUDE_EXPLANATION'}],'학생');
assert.deepEqual(manifest.imageUrls,['/same.png','/set.png','/choice.png','/right.png']);
assert.ok(manifest.fontCharacters.includes('학')&&manifest.fontCharacters.includes('질'));
assert.equal(manifest.fontCharacters.includes('V'),false,'No answer or explanation font text is prefetched');
assert.equal(new Set(manifest.fontCharacters).size,[...manifest.fontCharacters].length);

const env=environment(),loader=createMockExamAssetLoader(env),progress=[];
const nine={imageUrls:[...Array.from({length:9},(_,i)=>`/${i}.png`),'/0.png'],fontCharacters:'본문'};
await loader.prepare(nine,{onProgress:value=>progress.push(value)});
assert.equal(env.requests.length,9,'Duplicate URLs are requested once');
assert.equal(env.decodes.length,9,'All images finish decode before preparation resolves');
assert.ok(env.maxActive<=4,'Bounded parallel downloads');
assert.deepEqual(progress.at(-1),{loaded:10,total:10});
await loader.prepare(nine);
assert.equal(env.requests.length,9,'Decode cache is reused on explicit retry');
assert.equal(env.fontLoads.length,3,'Prepared fonts are reused after START and on retry');
await loader.prepare({...nine,fontCharacters:'본문龜'});
assert.equal(env.fontLoads.length,5,'Only new body glyphs load for a changed manifest');
assert(env.fontLoads.slice(3).every(load=>load.characters==='龜'),'Already prepared glyphs are not requested again');
await loader.prepare({imageUrls:['/new.png']});
await loader.prepare({imageUrls:['/0.png']});
assert.equal(env.requests.filter(value=>value==='/0.png').length,2,'Previous papers do not remain retained');
loader.dispose();
await assert.rejects(loader.prepare(nine),error=>error.name==='AbortError');

const failedEnv=environment({failImage:'/broken.png'}),failed=createMockExamAssetLoader(failedEnv);
await assert.rejects(failed.prepare({imageUrls:['/broken.png']}),error=>error instanceof MockExamAssetError&&error.reason==='image');
await assert.rejects(failed.prepare({imageUrls:['/broken.png']}));
assert.equal(failedEnv.requests.length,2,'A failure is never cached as ready');
failed.dispose();

const fontEnv=environment({failFonts:true});
await assert.rejects(createMockExamAssetLoader(fontEnv).prepare({imageUrls:[]}),error=>error.reason==='font');
const emptyFontEnv=environment();emptyFontEnv.fonts.load=async()=>[];
await assert.rejects(createMockExamAssetLoader(emptyFontEnv).prepare({imageUrls:[]}),error=>error.reason==='font');

const timeoutEnv=environment({delay:80,timeoutMs:10}),timed=createMockExamAssetLoader(timeoutEnv);
await assert.rejects(timed.prepare({imageUrls:['/slow.png']}),error=>error.reason==='timeout');
assert.deepEqual(timeoutEnv.removed,['/slow.png']);timed.dispose();

const abortEnv=environment({delay:80}),aborted=createMockExamAssetLoader(abortEnv),controller=new AbortController();
const abortedPromise=aborted.prepare(nine,{signal:controller.signal});controller.abort();
await assert.rejects(abortedPromise,error=>error.name==='AbortError');
assert.equal(abortEnv.requests.length,4,'Cancellation never starts queued downloads');
aborted.dispose();
await sleep(100);
console.log('Mock exam assets: deduplication, bounded concurrency, decode/font readiness, retry, timeout, cancellation and privacy passed.');
