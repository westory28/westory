// Temporary test-only workaround for firebase-tools 15.15.0 parsing each
// Storage rules stdout chunk as a complete JSON response. Keep warnings intact.
const Module = require('node:module');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const runtimeSuffix = '/firebase-tools/lib/emulator/storage/rules/runtime.js';

function frameStdout(stdout, limit = 16 * 1024 * 1024) {
  const emit = stdout.emit;
  const decoder = new StringDecoder('utf8');
  let pending = '';
  function consume(text, final = false) {
    pending += text;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      if (newline > limit) throw new Error('Storage rules response exceeds framing limit');
      const line = pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
      emit.call(stdout, 'data', Buffer.from(line, 'utf8'));
    }
    if (pending.length > limit) throw new Error('Storage rules response exceeds framing limit');
    if (final && pending) {
      emit.call(stdout, 'data', Buffer.from(pending, 'utf8'));
      pending = '';
    }
  }
  stdout.emit = function (event, ...args) {
    if (event === 'data') {
      consume(typeof args[0] === 'string' ? args[0] : decoder.write(args[0]));
      return this.listenerCount('data') > 0;
    }
    if (event === 'end') consume(decoder.end(), true);
    return emit.call(this, event, ...args);
  };
  return stdout;
}

function wrapSpawn(original) {
  return function (binary, args, options) {
    const child = original(binary, args, options);
    if (Array.isArray(args) && args.some(arg => /(?:^|[\\/])cloud-storage-rules-runtime[^\\/]*\.jar$/.test(arg))) {
      if (!child.stdout) throw new Error('Storage rules runtime stdout is unavailable');
      frameStdout(child.stdout);
    }
    return child;
  };
}

function install() {
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    const original = load.apply(this, arguments);
    if (request !== 'cross-spawn' || !parent?.filename.replace(/\\/g, '/').endsWith(runtimeSuffix)) return original;
    const packageFile = path.resolve(path.dirname(parent.filename), '../../../../package.json');
    if (load.call(this, packageFile, parent, false).version !== '15.15.0') {
      throw new Error('Reassess Storage rules framing workaround before changing firebase-tools version');
    }
    return Object.assign(function (...args) { return original(...args); }, original, { spawn: wrapSpawn(original.spawn) });
  };
}

module.exports = { frameStdout, wrapSpawn };
install();
