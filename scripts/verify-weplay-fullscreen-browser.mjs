/** Actual shared game frame and naval styles; synthetic body, no backend access. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const require = createRequire(import.meta.url), root = process.cwd();
const { build } = require('esbuild');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = path.join(root, 'output/weplay-fullscreen-20261117');
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Frame from './src/components/common/weplay/WeplayGameFrame';import './src/components/common/weplay/naval-battle.css';function App(){return <Frame><section className={'naval-game'+(new URLSearchParams(location.search).has('compact')?' naval-game--compact':'')} style={{'--naval-viewport-height':'390px'}}><div className="naval-scene"><div className="naval-topbar"><strong>이순신</strong><input aria-label="입력"/></div><div className="naval-footer"><button>나가기</button></div></div></section></Frame>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', outfile: 'qa.js', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'assets', setup(b) { b.onResolve({ filter: /^\/assets\// }, args => ({ path: args.path, external: true })); } }] });
const outputs = new Map(bundle.outputFiles.map(file => [path.basename(file.path), file.contents]));
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (outputs.has(name)) { res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(outputs.get(name)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#ddd;min-height:1500px}</style><div id="root"></div><script type="module" src="/qa.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
try {
  for (const [width, height] of [[390,844],[768,1024],[1280,800]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.address().port}`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?${width < 800 ? 'compact' : ''}`);
    await page.evaluate(() => { Element.prototype.requestFullscreen = async () => { throw new Error('restricted'); }; });
    const button = page.getByRole('button', { name: '게임 전체 화면', exact: true });
    await button.click();
    await page.locator('.weplay-game-frame--fullscreen').waitFor();
    const geometry = await page.locator('.weplay-game-frame').evaluate(node => {
      const box=node.getBoundingClientRect(),control=node.querySelector('.weplay-frame-fullscreen').getBoundingClientRect(),scene=node.querySelector('.naval-scene').getBoundingClientRect();
      return { width:box.width,height:box.height,x:box.x,y:box.y,control:{x:control.x,y:control.y,bottom:control.bottom,right:control.right,height:control.height},sceneBottom:scene.bottom,overflow:getComputedStyle(document.body).overflowY };
    });
    assert.deepEqual([geometry.x,geometry.y,geometry.width,geometry.height],[0,0,width,height]);
    assert.ok(geometry.control.height >= 44 && geometry.control.right <= width && geometry.control.bottom <= height);
    assert.ok(geometry.control.y >= geometry.sceneBottom, 'fullscreen control never overlays gameplay');
    assert.equal(geometry.overflow,'hidden');
    await page.screenshot({path:path.join(evidence,`fallback-${width}.png`)});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.weplay-game-frame--fullscreen'));
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'visible');
    assert.equal(await button.evaluate(node=>node===document.activeElement),true);
    checks.push(`${width}px restricted-native fallback fills viewport, keeps 44px controls outside game, Escape restores focus and scroll`);
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'게임 전체 화면',exact:true}).click();
  await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('weplay-game-frame'));
  await page.getByRole('button',{name:'전체 화면 나가기',exact:true}).click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  checks.push('Native fullscreen enter and explicit exit succeed');
  assert.deepEqual(errors,[]);
  console.log(checks.join('\n'));
} finally {
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({checks,errors},null,2));
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
