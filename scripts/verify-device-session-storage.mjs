import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const storageSource = compile("src/lib/safeStorage.ts");
const sessionSource = compile("src/lib/deviceSession.ts");
const DAY = 86400000;
const fixture = () => {
  const values = new Map();
  const state = {
    now: 1800000000000,
    readBlocked: false,
    writeBlocked: false,
    writes: 0,
  };
  const localStorage = {
    getItem(key) {
      if (state.readBlocked) throw new Error("Read denied");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      state.writes++;
      if (state.writeBlocked) throw new Error("Quota exceeded");
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  class Clock extends Date {
    static now() {
      return state.now;
    }
  }
  const load = (source, dependencies) => {
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module,
      exports: module.exports,
      require(name) {
        assert.ok(name in dependencies, `Unexpected import: ${name}`);
        return dependencies[name];
      },
      window: {
        localStorage,
        sessionStorage: { removeItem() {} },
      },
      Date: Clock,
      console: { warn() {} },
    });
    return module.exports;
  };
  const archive = { isSemesterArchive: false };
  const storage = load(storageSource, { "./semesterArchive": archive });
  const api = load(sessionSource, {
    "./semesterArchive": archive,
    "./safeStorage": storage,
  });
  const uid = "teacher-a";
  const epoch = 1799990000;
  return { values, state, api, uid, epoch, key: api.getDeviceSessionKey(uid) };
};

{
  const f = fixture();
  const initial = f.api.initializeDeviceSession(f.uid, f.epoch);
  f.state.now += 29 * DAY;
  f.state.writeBlocked = true;
  const renewed = f.api.extendDeviceSession(f.uid, f.epoch);
  assert.equal(JSON.parse(f.values.get(f.key)).expiresAt, initial.expiresAt);
  f.state.now = initial.expiresAt + DAY;
  assert.equal(
    f.api.readDeviceSession(f.uid, f.epoch).expiresAt,
    renewed.expiresAt,
    "A rejected activity write must not cause logout at the older disk deadline",
  );
  const writes = f.state.writes;
  for (let index = 0; index < 1000; index++)
    f.api.readDeviceSession(f.uid, f.epoch);
  assert.equal(
    f.state.writes,
    writes,
    "Reading a fallback never retries writes",
  );
  f.state.writeBlocked = false;
  const recovered = f.api.extendDeviceSession(f.uid, f.epoch);
  assert.equal(JSON.parse(f.values.get(f.key)).expiresAt, recovered.expiresAt);
  f.values.delete(f.key);
  assert.equal(
    f.api.readDeviceSession(f.uid, f.epoch),
    null,
    "A recovered write retires fallback before another tab removes the key",
  );
}

for (const change of ["remove", "same-epoch-activity", "newer-login"]) {
  const f = fixture();
  f.api.initializeDeviceSession(f.uid, f.epoch);
  f.state.now += DAY;
  f.state.writeBlocked = true;
  f.api.extendDeviceSession(f.uid, f.epoch);
  const remoteEpoch = change === "newer-login" ? f.epoch + 1 : f.epoch;
  const remoteExpiry = f.state.now + 40 * DAY;
  if (change === "remove") f.values.delete(f.key);
  else
    f.values.set(
      f.key,
      JSON.stringify({ authTime: remoteEpoch, expiresAt: remoteExpiry }),
    );
  assert.equal(
    f.api.readDeviceSession(f.uid, f.epoch)?.expiresAt ?? null,
    change === "same-epoch-activity" ? remoteExpiry : null,
    `A failed local write cannot mask another tab's ${change}`,
  );
  if (change === "newer-login") {
    assert.equal(f.api.initializeDeviceSession(f.uid, f.epoch), null);
    assert.equal(f.api.extendDeviceSession(f.uid, f.epoch), null);
    assert.equal(
      f.api.readDeviceSession(f.uid, remoteEpoch).expiresAt,
      remoteExpiry,
    );
  }
}

{
  const f = fixture();
  f.state.writeBlocked = true;
  const initial = f.api.initializeDeviceSession(f.uid, f.epoch);
  assert.equal(f.values.has(f.key), false);
  f.state.now += DAY;
  assert.equal(
    f.api.initializeDeviceSession(f.uid, f.epoch).expiresAt,
    initial.expiresAt,
    "A new login remains usable when storage reads succeed but writes fail",
  );
  assert.equal(f.api.readDeviceSession("student-b", f.epoch), null);
  f.api.clearDeviceSession(f.uid);
  assert.equal(f.api.readDeviceSession(f.uid, f.epoch), null);
  f.state.now = initial.expiresAt + DAY;
  assert.equal(f.api.extendDeviceSession(f.uid, f.epoch), null);
}

{
  const f = fixture();
  const initial = f.api.initializeDeviceSession(f.uid, f.epoch);
  f.state.now += 29 * DAY;
  f.state.readBlocked = true;
  f.state.writeBlocked = true;
  const renewed = f.api.extendDeviceSession(f.uid, f.epoch);
  assert.equal(
    f.api.readDeviceSession(f.uid, f.epoch).expiresAt,
    renewed.expiresAt,
  );
  f.state.readBlocked = false;
  f.state.now = initial.expiresAt + DAY;
  assert.equal(
    f.api.readDeviceSession(f.uid, f.epoch).expiresAt,
    renewed.expiresAt,
    "Read recovery must not discard activity recorded while storage was blocked",
  );
  f.values.delete(f.key);
  assert.equal(f.api.readDeviceSession(f.uid, f.epoch), null);
}

{
  const f = fixture();
  f.api.initializeDeviceSession(f.uid, f.epoch);
  f.state.now += DAY;
  f.state.writeBlocked = true;
  const renewed = f.api.extendDeviceSession(f.uid, f.epoch);
  f.state.now = renewed.expiresAt;
  assert.equal(
    f.api.extendDeviceSession(f.uid, f.epoch).expiresAt,
    renewed.expiresAt,
    "Storage fallback must not revive an actually expired session",
  );
}

console.log(
  "PASS: device session quota failures, in-memory continuity, recovery, cross-tab removal/activity/new login, account isolation, explicit logout, and expired-session fences.",
);
