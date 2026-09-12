const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { frameStdout, wrapSpawn } = require('./firebase-storage-runtime-framing.cjs');

function receive(chunks, limit) {
  const stream = frameStdout(new EventEmitter(), limit);
  const frames = [];
  stream.on('data', chunk => frames.push(chunk.toString('utf8')));
  chunks.forEach(chunk => stream.emit('data', chunk));
  stream.emit('end');
  return frames;
}
const record = JSON.stringify({ id: 7, status: 'ok', errors: ['권한 거부'], warnings: ['표현식 경고 '.repeat(15000)] }) + '\n';
const bytes = Buffer.from(record);
assert.deepEqual(receive([bytes.subarray(0, 65536), bytes.subarray(65536)]), [record]);
const short = Buffer.from('{"id":1,"warnings":["한글🙂"]}\n');
for (let index = 0; index <= short.length; index++) {
  assert.deepEqual(receive([short.subarray(0, index), short.subarray(index)]), [short.toString()]);
}
assert.deepEqual(receive([...short].map(byte => Buffer.from([byte]))), [short.toString()]);
assert.deepEqual(receive([Buffer.from('\n' + record + short + '{"id":3}')]), ['\n', record, short.toString(), '{"id":3}']);
assert.deepEqual(JSON.parse(receive([bytes])[0]), JSON.parse(record));
assert.throws(() => receive([Buffer.from('123456')], 5), /exceeds framing limit/);
assert.throws(() => receive([Buffer.from('123456\n')], 5), /exceeds framing limit/);
let called;
const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
const oldEmit = child.stdout.emit;
const spawn = wrapSpawn((...args) => { called = args; return child; });
const options = { stdio: ['pipe', 'pipe', 'pipe'] };
assert.equal(spawn('java', ['unrelated.jar'], options), child);
assert.equal(child.stdout.emit, oldEmit);
assert.deepEqual(called, ['java', ['unrelated.jar'], options]);
const stderrEmit = child.stderr.emit;
assert.equal(spawn('java', ['-jar', 'C:\\cache\\cloud-storage-rules-runtime-v1.1.3.jar'], options), child);
assert.notEqual(child.stdout.emit, oldEmit);
assert.equal(child.stderr.emit, stderrEmit);
let error;
child.stdout.on('error', value => { error = value; });
const expectedError = new Error('original runtime error');
child.stdout.emit('error', expectedError);
assert.equal(error, expectedError);
console.log('PASS Storage rules framing: large/split/coalesced/UTF8/final/error/bounds/spawn isolation');
