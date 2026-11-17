/** Review historical additions in their intended combinations; no server access. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root=process.cwd(),require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright')}catch{playwright=require(process.env.PLAYWRIGHT_MODULE_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const output=process.env.AVATAR_ART_EVIDENCE_DIR||path.join(root,'output/avatar-ranks-20261117/art');
const ids=['gonryongpo','ikseongwan','waryonggwan','court-dangui','gache','silk-durumagi','hakchangui','wide-gat','silk-jeogori','silk-chima','white-durumagi','narrow-gat','tanggeon','cotton-jeogori','hemp-jeoksam','hemp-chima','plain-jeogori','plain-baji','headcloth'];
const {outputFiles}=await build({stdin:{contents:`
import {drawMinimi} from './src/features/avatar/minimi/draw';
import {defaultAvatarLook,AVATAR_ITEMS} from './src/features/avatar/catalog';
window.render=()=>{
const ids=${JSON.stringify(ids)}, c=document.createElement('canvas'); c.width=1200;c.height=5*420;
const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#f2f4f6';ctx.fillRect(0,0,c.width,c.height);
const s=document.createElement('canvas');s.width=80;s.height=112;const p=s.getContext('2d');
const tiers=['왕실','양반','중인','상민','노비'];
const rows=[ids.slice(0,5),ids.slice(5,10),ids.slice(10,13),ids.slice(13,16),ids.slice(16)];
for(const [r,row]of rows.entries())for(const [col,id]of row.entries()){
const item=AVATAR_ITEMS.find(i=>i.value==='mm-hanbok-'+id);if(!item)throw Error(id);
const character=item.gender==='girl'?'girl':'boy';const look={...defaultAvatarLook(character),hairTone:'mm-ink',hairStyle:character==='girl'?'mm-long':'mm-parted',top:'mm-hanbok-plain-jeogori',bottom:character==='girl'?'mm-hanbok-silk-chima':'mm-hanbok-plain-baji',shoes:character==='girl'?'mm-hanbok-flower-red':'mm-hanbok-jipsin'};
if(['gonryongpo','ikseongwan'].includes(id))Object.assign(look,{top:'mm-hanbok-gonryongpo',accessory:'mm-hanbok-ikseongwan',shoes:'mm-hanbok-mokhwa'});
if(['waryonggwan','hakchangui'].includes(id))Object.assign(look,{top:'mm-hanbok-hakchangui',accessory:'mm-hanbok-waryonggwan',shoes:'mm-hanbok-mokhwa'});
if(['court-dangui','gache'].includes(id))Object.assign(look,{top:'mm-hanbok-court-dangui',accessory:'mm-hanbok-gache'});
if(['silk-durumagi','wide-gat'].includes(id))Object.assign(look,{top:'mm-hanbok-silk-durumagi',accessory:'mm-hanbok-wide-gat',shoes:'mm-hanbok-mokhwa'});
if(['silk-jeogori','silk-chima'].includes(id))Object.assign(look,{top:'mm-hanbok-silk-jeogori',bottom:'mm-hanbok-silk-chima',accessory:'mm-hanbok-binyeo'});
if(['white-durumagi','narrow-gat','tanggeon'].includes(id))Object.assign(look,{top:'mm-hanbok-white-durumagi',accessory:'mm-hanbok-'+(id==='tanggeon'?'tanggeon':'narrow-gat')});
if(id==='hemp-chima')Object.assign(look,{top:'mm-hanbok-hemp-jeoksam',bottom:item.value,shoes:'mm-hanbok-jipsin'});
look[item.slot]=item.value;drawMinimi(p,look);
const x=col*240,y=r*420;ctx.drawImage(s,x,y+20,240,336);ctx.fillStyle='#172b3a';ctx.textAlign='center';ctx.font='bold 18px "Malgun Gothic",sans-serif';ctx.fillText(item.label,x+120,y+380);ctx.font='14px "Malgun Gothic",sans-serif';ctx.fillStyle='#5a6773';ctx.fillText(tiers[r]+' 이상 · '+item.price+' 위스',x+120,y+406);
}return c.toDataURL('image/png');};`,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm'});
const server=http.createServer((req,res)=>req.url==='/bundle.js'?res.writeHead(200,{'Content-Type':'text/javascript'}).end(outputFiles[0].contents):res.writeHead(200,{'Content-Type':'text/html'}).end('<meta charset="utf-8"><script type="module" src="/bundle.js"></script>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge'});
try{const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);await page.waitForFunction(()=>typeof window.render==='function');const data=await page.evaluate(()=>window.render());await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'joseon-outfits.png'),Buffer.from(data.split(',')[1],'base64'));console.log('Rendered 19 historical items in five rank rows.')}finally{await browser.close();await new Promise(r=>server.close(r))}
