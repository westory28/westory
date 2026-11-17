const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve, delimiter } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '../..');
const env = { ...process.env };
if (process.platform === 'win32') {
  const java = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
  const javaHome = /^\s*java\.home\s*=\s*(.+)$/m.exec(java.stderr || '')?.[1].trim();
  if (!javaHome || java.status !== 0) throw new Error('Cannot locate the Firestore emulator JDK.');
  const key = Object.keys(env).find(value => value.toUpperCase() === 'PATH') || 'PATH';
  env[key] = join(javaHome, 'bin') + delimiter + env[key];
}
const temporary = mkdtempSync(join(tmpdir(), 'westory-likers-emulator-'));
try {
  const config = join(temporary, 'firebase.json');
  writeFileSync(config, JSON.stringify({
    firestore: { rules: join(root, 'firestore.rules') },
    emulators: { firestore: { host: '127.0.0.1', port: 18225 }, hub: { host: '127.0.0.1', port: 14475 },
      logging: { host: '127.0.0.1', port: 14575 }, ui: { enabled: false } },
  }));
  const run = spawnSync(`firebase emulators:exec --only firestore --config "${config}" --project demo-westory-session-developer-log-likers "node functions/scripts/verify-developer-log-like-students.cjs --emulator"`,
    { shell: true, env, cwd: root, stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  const resolvedTemporary = resolve(temporary);
  const resolvedTempRoot = resolve(tmpdir());
  if (!resolvedTemporary.startsWith(resolvedTempRoot + require('node:path').sep)
    || !require('node:path').basename(resolvedTemporary).startsWith('westory-likers-emulator-')) {
    throw new Error('Unexpected emulator temporary directory; cleanup refused.');
  }
  rmSync(resolvedTemporary, { recursive: true, force: true });
}
