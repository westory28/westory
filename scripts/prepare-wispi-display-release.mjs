import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, functionUrl, inventory, normalize, readCloud, resourceFields, resourceValue,
  root, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Existing settlement workers have function-specific production sources.
// Apply only the reviewed display hunks and preserve every other file.
const names = ['settleWisStockOrderTask', 'onWisStockMarketTradingWrite', 'recoverWisStockOrders'];
const mode = process.argv[2];
assert.ok(['prepare', 'verify'].includes(mode));
const output = path.join(root, 'output/wspi-display-20261121');
const token = accessToken();
const patch = normalize(execFileSync('git', ['diff', '--no-color', '--unified=3',
  '483030f4e0568abef7d20e5806b6535108f16443', '--', 'functions/wisStockTrading.js'], { cwd: root, encoding: 'utf8' }));
const hunks = patch.split(/^@@.*@@.*\n/gm).slice(1).map(hunk => hunk.trimEnd().split('\n'));
assert.equal(hunks.length, 3);
const groups = new Map();
const normalizedTrigger = trigger => trigger && {
  ...trigger,
  eventFilters: [...(trigger.eventFilters || [])].sort((a, b) => a.attribute.localeCompare(b.attribute)),
};
for (const name of names) {
  const metadata = await (await readCloud(functionUrl(name), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
  const manifestPath = path.join(output, name, 'display-manifest.json');
  if (mode === 'verify') {
    const manifest = JSON.parse(await fs.readFile(manifestPath));
    assert.deepEqual(Object.fromEntries(entries.map(e => [e.path, e.sha256])), manifest.hashes, name);
    for (const field of resourceFields)
      assert.equal(resourceValue(metadata.serviceConfig, field), resourceValue(manifest.serviceConfig, field), name + '/' + field);
    assert.deepEqual(normalizedTrigger(metadata.eventTrigger), normalizedTrigger(manifest.eventTrigger));
    console.log(name, 'ACTIVE', metadata.serviceConfig.revision);
    continue;
  }
  const key = sha(JSON.stringify(entries.map(e => [e.path, e.sha256]))).slice(0, 16);
  const directory = path.join(output, 'prepared-' + key);
  const dest = path.join(directory, 'functions');
  const hashes = {};
  for (const { path: file, body: original } of entries) {
    let body = original;
    if (file === 'wisStockTrading.js') {
      let source = normalize(original.toString());
      for (const hunk of hunks) {
        const before = hunk.filter(line => line[0] !== '+').map(line => line.slice(1)).join('\n');
        const after = hunk.filter(line => line[0] !== '-').map(line => line.slice(1)).join('\n');
        assert.equal(source.split(before).length, 2, 'Unrecognized live trading source');
        source = source.replace(before, () => after);
      }
      body = Buffer.from(source);
    }
    hashes[file] = sha(body);
    if (!groups.has(key)) {
      await fs.mkdir(path.dirname(path.join(dest, file)), { recursive: true });
      await fs.writeFile(path.join(dest, file), body);
    }
  }
  const added = 'wisStockDisplay.js';
  assert.ok(!hashes[added]);
  const display = await fs.readFile(path.join(root, 'functions', added));
  hashes[added] = sha(display);
  if (!groups.has(key)) {
    await fs.writeFile(path.join(dest, added), display);
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22' } }));
    groups.set(key, { directory, names: [] });
  }
  groups.get(key).names.push(name);
  assert.deepEqual(Object.fromEntries((await inventory(dest)).map(e => [e.path, e.sha256])), hashes);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ hashes, serviceConfig: metadata.serviceConfig, eventTrigger: metadata.eventTrigger }));
}
if (mode === 'prepare') {
  await fs.writeFile(path.join(output, 'groups.json'), JSON.stringify([...groups.values()]));
  console.log([...groups.values()]);
}
