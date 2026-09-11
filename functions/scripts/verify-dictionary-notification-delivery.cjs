const assert = require("node:assert/strict");
const { Store } = require("./verify-lesson-answers.cjs");
const { buildResolutionEvent, createDictionaryNotificationDelivery, COLLECTION } = require("../dictionaryNotifications");
const event = (updatedAt = 1) => buildResolutionEvent({ requestId: "request-one", requestData: { updatedAt, status: "requested" }, uid: "student-one", year: "2026", semester: "2", word: "고려", termId: "term-one", actorUid: "teacher-one", timestamp: 10 });
const setup = () => {
  let now = 1000, fail = false, loseAck = false, calls = 0;
  const initial = event(), store = new Store({ [initial.path]: initial.data });
  const sink = new Map();
  const snap = (path, data) => ({ exists: data.exists, data: () => data.data, ref: db.doc(path) });
  const db = {
    doc: path => ({ path }),
    collection: collection => ({ where: () => ({ limit: limit => ({ get: async () => ({ docs: [...store.docs].filter(([path,data]) => path.startsWith(collection + "/") && data.nextAttemptAtMs <= now).slice(0, limit).map(([path]) => ({ ref: db.doc(path) })) }) }) }) }),
    runTransaction: callback => store.runTransaction(transaction => callback({
      get: async ref => snap(ref.path, await transaction.get(ref.path)),
      set: (ref, value, options) => transaction.set(ref.path, value, options),
    })),
  };
  const deliver = createDictionaryNotificationDelivery({ db, now: () => now, deleteField: () => "deleted", deliver: async (year, semester, uid, payload) => {
    calls++;
    if (fail) throw new Error("offline");
    assert.equal(year,"2026"); assert.equal(semester,"2"); assert.equal(uid,"student-one");
    sink.set(payload.dedupeKey, payload);
    if (loseAck) { loseAck = false; throw new Error("ack lost after sink committed"); }
  } });
  return { store, initial, deliver, sink, get calls() { return calls; }, setTime: value => now=value, fail: value => fail=value, loseAck: () => loseAck=true };
};
(async () => {
  assert.equal(event().path,event().path);
  assert.notEqual(event().path,event(2).path,"reopened request has a new event");
  const failed = setup(); failed.fail(true);
  assert.deepEqual(await failed.deliver([failed.initial.path]), { delivered:0, deferred:1 });
  assert.equal(failed.store.docs.get(failed.initial.path).status,"PENDING");
  assert.equal(failed.sink.size,0);
  assert.deepEqual(await failed.deliver(), { delivered:0, deferred:0 },"backoff prevents immediate repeats");
  failed.setTime(100000); failed.fail(false);
  assert.deepEqual(await failed.deliver(),{ delivered:1,deferred:0 });
  assert.equal(failed.store.docs.get(failed.initial.path).status,"DELIVERED");
  assert.equal(failed.sink.size,1);
  await failed.deliver([failed.initial.path]); assert.equal(failed.calls,2);
  const lost = setup(); lost.loseAck();
  await lost.deliver(); assert.equal(lost.sink.size,1);
  lost.setTime(100000); await lost.deliver();
  assert.equal(lost.sink.size,1,"sink id remains identical after lost acknowledgement");
  assert.equal(lost.store.docs.get(lost.initial.path).status,"DELIVERED");
  const concurrent = setup();
  await Promise.all([concurrent.deliver(),concurrent.deliver()]);
  assert.equal(concurrent.calls,1); assert.equal(concurrent.sink.size,1);
  const crash = setup();
  crash.store.docs.set(crash.initial.path,{...crash.initial.data,status:"DELIVERING",nextAttemptAtMs:5000,lease:"crashed-worker"});
  await crash.deliver(); assert.equal(crash.calls,0);
  crash.setTime(6000); await crash.deliver(); assert.equal(crash.calls,1);
  await assert.rejects(crash.deliver(["users/another-student"]),/Invalid dictionary outbox path/);
  console.log(JSON.stringify({passed:true,coverage:"atomic outbox event keys, reopened request, delivery failure/backoff, lost acknowledgement dedupe, concurrent lease, crashed lease recovery, bounded path fence",networkAccess:0,collection:COLLECTION}));
})().catch(error => { console.error(error); process.exitCode=1; });
