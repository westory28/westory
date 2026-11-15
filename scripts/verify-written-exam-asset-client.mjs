// Synthetic binary fixtures only. No network or production credentials.
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { build } from "esbuild";

const CHUNK = 4 * 1024 * 1024;
let authTime = 100;
const account = {
  uid: "synthetic-teacher",
  getIdTokenResult: async () => ({ claims: { auth_time: authTime } }),
};
const auth = { currentUser: account };
const calls = [];
let respond;
let beforeDispatch;
const fixture = {
  auth,
  archive: false,
  sessionReads: [],
  session: {
    status: "active",
    authorityGeneration: "test-generation",
    protocolVersion: 2,
    sessionRevision: "test-revision",
  },
  archiveCalls: [],
  readSession: async (path) => {
    fixture.sessionReads.push(path);
    return { data: () => fixture.session };
  },
  archiveRead: async (data) => {
    fixture.archiveCalls.push(data);
    return { data: await respond(data) };
  },
  writable: () => {
    if (fixture.archive) throw new Error("archive read only");
  },
  call: async (name, data, user, options) => {
    assert.equal(name, "manageWrittenExamAsset");
    assert.equal(user, account);
    beforeDispatch?.();
    options.beforeDispatch();
    calls.push(data);
    return { data: await respond(data) };
  },
};
const built = await build({
  entryPoints: ["src/lib/writtenExamAssets.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  plugins: [
    {
      name: "asset-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^\.\/(firebase|applicationSession|semesterArchive)$|^firebase\/(firestore|functions)$/,
          },
          ({ path }) => ({ path, namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "firebase/firestore"
              ? "export const doc=(_db,path)=>path;export const getDocFromServer=(path)=>globalThis.fixture.readSession(path);"
              : path === "firebase/functions"
                ? "export const getFunctions=()=>({});export const httpsCallable=(_functions,name)=>{if(name!=='manageWrittenExamAsset')throw Error(name);return(data)=>globalThis.fixture.archiveRead(data)};"
                : path.endsWith("semesterArchive")
                  ? "export const isSemesterArchive=globalThis.fixture.archive;export const assertArchiveWritable=()=>globalThis.fixture.writable();"
                  : path.endsWith("firebase")
                    ? "export const auth=globalThis.fixture.auth;export const db={};export const readWrittenExamAssetChunk=async(input,beforeDispatch)=>{globalThis.fixture.beforeArchiveDispatch?.();await beforeDispatch?.();return globalThis.fixture.archiveRead({...input,action:'read'})};"
                    : "export const callWithApplicationSession=(...args)=>globalThis.fixture.call(...args);",
        }));
      },
    },
  ],
});
const createApi = () => {
  const module = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    Blob,
    Uint8Array,
    ArrayBuffer,
    crypto: webcrypto,
    atob,
    btoa,
  });
  return module.exports;
};
const api = createApi();
const path =
  "years/2026/semesters/2/written_exam_analyses/exam/revision/paper.pdf";
const bytes = Buffer.alloc(CHUNK + 17, 19);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const blob = new Blob([bytes], { type: "application/pdf" });
const readResponse = ({ chunkIndex }) => ({
  chunkIndex,
  contentType: blob.type,
  totalSize: bytes.length,
  sha256,
  contentBase64: bytes
    .subarray(chunkIndex * CHUNK, (chunkIndex + 1) * CHUNK)
    .toString("base64"),
});
let checks = 0;
const check = async (name, run) => {
  calls.length = 0;
  auth.currentUser = account;
  beforeDispatch = undefined;
  await run();
  checks++;
  console.log(`PASS ${name}`);
};
await check("4 MiB chunk upload preserves all bytes and digest", async () => {
  respond = ({ chunkIndex }) => ({
    accepted: true,
    complete: chunkIndex === 1,
  });
  await api.uploadWrittenExamAsset(path, blob);
  assert.deepEqual(
    calls.map(({ chunkIndex }) => chunkIndex),
    [0, 1],
  );
  assert.ok(
    calls.every(
      (call) => call.sha256 === sha256 && call.totalSize === bytes.length,
    ),
  );
  assert.deepEqual(
    Buffer.concat(
      calls.map((call) => Buffer.from(call.contentBase64, "base64")),
    ),
    bytes,
  );
});
await check(
  "upload limit and completion acknowledgement are enforced",
  async () => {
    respond = () => ({ accepted: true, complete: false });
    await assert.rejects(api.uploadWrittenExamAsset(path, blob), /저장/);
    const before = calls.length;
    for (const invalid of [
      new Blob([], { type: "application/pdf" }),
      new Blob(["x"], { type: "text/html" }),
      new Blob([Buffer.alloc(12 * 1024 * 1024 + 1)], { type: "image/png" }),
    ])
      await assert.rejects(api.uploadWrittenExamAsset(path, invalid), /30MB/);
    assert.equal(calls.length, before);
  },
);
await check(
  "account switch after first upload prevents the next chunk",
  async () => {
    respond = () => {
      auth.currentUser = { uid: account.uid };
      return { accepted: true, complete: false };
    };
    await assert.rejects(api.uploadWrittenExamAsset(path, blob), /로그인/);
    assert.equal(calls.length, 1);
  },
);
await check(
  "same UID with a new session is blocked before dispatch",
  async () => {
    beforeDispatch = () => {
      auth.currentUser = { uid: account.uid };
    };
    await assert.rejects(api.readWrittenExamAsset(path), /로그인/);
    assert.equal(calls.length, 0);
  },
);
await check(
  "two-chunk read verifies size, media type and full digest",
  async () => {
    respond = readResponse;
    const read = await api.readWrittenExamAsset(path);
    assert.equal(read.type, "application/pdf");
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    assert.equal(calls.length, 2);
  },
);
for (const [name, change] of [
  ["wrong chunk index", { chunkIndex: 3 }],
  ["unsupported MIME", { contentType: "text/html" }],
  ["truncated chunk", { contentBase64: "YQ==" }],
  ["invalid base64", { contentBase64: "!!!!" }],
  ["oversized declaration", { totalSize: 31 * 1024 * 1024 }],
])
  await check(`read rejects ${name}`, async () => {
    respond = (input) => ({ ...readResponse(input), ...change });
    await assert.rejects(api.readWrittenExamAsset(path));
    assert.equal(calls.length, 1);
  });
await check(
  "read rejects metadata changes across chunks and hash corruption",
  async () => {
    respond = (input) => ({
      ...readResponse(input),
      ...(input.chunkIndex ? { totalSize: bytes.length - 1 } : {}),
    });
    await assert.rejects(api.readWrittenExamAsset(path), /정보/);
    respond = (input) => ({ ...readResponse(input), sha256: "0".repeat(64) });
    await assert.rejects(api.readWrittenExamAsset(path), /내용/);
  },
);
await check("legacy asset without digest remains byte-exact", async () => {
  respond = (input) => {
    const result = readResponse(input);
    delete result.sha256;
    return result;
  };
  assert.deepEqual(
    Buffer.from(await (await api.readWrittenExamAsset(path)).arrayBuffer()),
    bytes,
  );
});
await check("read account switch discards fetched bytes", async () => {
  respond = (input) => {
    auth.currentUser = null;
    return readResponse(input);
  };
  await assert.rejects(api.readWrittenExamAsset(path), /로그인/);
  assert.equal(calls.length, 1);
});
await check(
  "removal requires an acknowledged session-bound result",
  async () => {
    respond = () => ({ deleted: false });
    await assert.rejects(api.removeWrittenExamAsset(path), /정리/);
    respond = () => ({ deleted: true });
    await api.removeWrittenExamAsset(path);
    auth.currentUser = null;
    await assert.rejects(api.removeWrittenExamAsset(path), /로그인/);
    assert.equal(calls.length, 2);
  },
);
fixture.archive = true;
const archiveApi = createApi();
await check(
  "archive read reuses existing session proof without opening or touching a session",
  async () => {
    respond = readResponse;
    assert.deepEqual(
      Buffer.from(
        await (await archiveApi.readWrittenExamAsset(path)).arrayBuffer(),
      ),
      bytes,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(
      fixture.sessionReads,
      Array(2).fill("application_sessions/synthetic-teacher/sessions/100"),
    );
    assert.equal(fixture.archiveCalls.length, 2);
    assert.ok(
      fixture.archiveCalls.every(
        (call) =>
          call.action === "read" && call._session.revision === "test-revision",
      ),
    );
  },
);
await check("archive upload and removal fail before any dispatch", async () => {
  const before = fixture.archiveCalls.length;
  await assert.rejects(
    archiveApi.uploadWrittenExamAsset(path, blob),
    /read only/,
  );
  await assert.rejects(archiveApi.removeWrittenExamAsset(path), /read only/);
  assert.equal(fixture.archiveCalls.length, before);
  assert.equal(calls.length, 0);
});
await check(
  "archive rejects missing session and changed auth time",
  async () => {
    const before = fixture.archiveCalls.length;
    const saved = fixture.session;
    fixture.session = undefined;
    await assert.rejects(archiveApi.readWrittenExamAsset(path), /로그인/);
    fixture.session = saved;
    assert.equal(fixture.archiveCalls.length, before);
    respond = (input) => {
      authTime = 101;
      return readResponse(input);
    };
    await assert.rejects(archiveApi.readWrittenExamAsset(path), /로그인/);
    assert.equal(fixture.archiveCalls.length, before + 1);
    assert.equal(calls.length, 0);
  },
);
await check(
  "archive lazy client initialization cannot dispatch after an account switch",
  async () => {
    const before = fixture.archiveCalls.length;
    fixture.beforeArchiveDispatch = () => {
      auth.currentUser = { ...account };
    };
    respond = readResponse;
    await assert.rejects(archiveApi.readWrittenExamAsset(path), /로그인/);
    assert.equal(fixture.archiveCalls.length, before);
    fixture.beforeArchiveDispatch = undefined;
  },
);
console.log(`PASS written exam asset client: ${checks} cases`);
