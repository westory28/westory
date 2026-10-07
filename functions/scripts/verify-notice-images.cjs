const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const sharp = require("sharp");
const { Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  createNoticeImageHandlers,
  uploadNoticeImageContent,
  deleteNoticeImageContent,
} = require("../noticeImages");
const {
  createStudentMaintenanceService,
  withStudentMaintenanceGuard,
} = require("../studentMaintenance");

const checks = [];
const proof = {
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const makeFixture = () => {
  const documents = new Map([
    ["site_settings/config", { year: "2026", semester: "2" }],
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 5 }],
    [
      "semester_manifests/2026-2",
      { semesterId: "2026-2", revision: 5, status: "ACTIVE", readOnly: false },
    ],
    [
      "users/teacher",
      { role: "teacher", registrationApprovalStatus: "APPROVED" },
    ],
    [
      "users/student",
      { role: "student", registrationApprovalStatus: "APPROVED" },
    ],
    [
      "users/staff",
      {
        role: "staff",
        registrationApprovalStatus: "APPROVED",
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read", "point_manage"],
      },
    ],
  ]);
  const saves = [],
    deletions = [],
    sessionCalls = [];
  const db = {
    doc: (path) => ({
      get: async () => ({
        exists: documents.has(path),
        data: () => documents.get(path),
      }),
    }),
  };
  const bucket = {
    file: (path) => ({
      save: async (buffer, options) => {
        saves.push({ path, buffer, options });
      },
      delete: async (options) => {
        deletions.push({ path, options });
      },
    }),
  };
  let sessionFailure = false,
    counter = 0;
  const handlers = createNoticeImageHandlers({
    db,
    bucket,
    createId: () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    assertSession: async (request) => {
      sessionCalls.push(request);
      if (
        !request.auth?.uid ||
        sessionFailure ||
        JSON.stringify(request.data?._session) !== JSON.stringify(proof)
      ) {
        throw new HttpsError(
          "unauthenticated",
          "Invalid application session proof",
        );
      }
    },
  });
  const service = createStudentMaintenanceService({ db });
  return {
    documents,
    saves,
    deletions,
    sessionCalls,
    upload: withStudentMaintenanceGuard(handlers.upload, { service }),
    remove: withStudentMaintenanceGuard(handlers.remove, { service }),
    expire: () => {
      sessionFailure = true;
    },
  };
};
const requestFor = (uid, data) => ({
  auth: {
    uid,
    token: {
      email:
        uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`,
      auth_time: 100,
    },
  },
  data: { ...data, _session: proof },
});
const maintenance = (enabled = true) => ({
  enabled,
  blockedRoles: ["student"],
  bypassUids: ["synthetic-bypass"],
  title: "점검 안내",
  message: "학생 서비스 점검 중입니다.",
  startedAt: enabled ? Timestamp.now() : null,
  updatedAt: Timestamp.now(),
  updatedBy: "admin",
  revision: 1,
});
const rejectsWithoutMutation = async (
  label,
  mutateRequest = () => {},
  mutateFixture = () => {},
  method = "upload",
) => {
  const fixture = makeFixture();
  const request = requestFor(
    "teacher",
    method === "upload" ? validPayload : { storagePath: validPath },
  );
  mutateRequest(request);
  mutateFixture(fixture);
  await assert.rejects(fixture[method](request));
  assert.equal(fixture.saves.length, 0);
  assert.equal(fixture.deletions.length, 0);
  checks.push(label);
};
let validPayload;
const validPath =
  "years/2026/semesters/2/notice_images/noticeFixture/notice-1791380553818.webp";

async function main() {
  const source = sharp({
    create: { width: 112, height: 63, channels: 3, background: "#356bd7" },
  });
  const webp = await source.clone().webp().toBuffer();
  validPayload = {
    year: "2026",
    semester: "2",
    noticeId: "noticeFixture",
    imageBase64: webp.toString("base64"),
    contentType: "image/webp",
  };

  for (const uid of ["admin", "teacher"]) {
    const fixture = makeFixture();
    fixture.documents.set("site_settings/student_maintenance", maintenance());
    const request = requestFor(uid, validPayload);
    const image = await fixture.upload(request);
    assert.equal(
      fixture.sessionCalls[0],
      request,
      "Full original request reaches the session-proof guard",
    );
    assert.equal(image.imageWidth, 112);
    assert.equal(image.imageHeight, 63);
    assert.equal(image.imageByteSize, webp.length);
    assert.equal(image.imageMimeType, "image/webp");
    assert.equal(fixture.saves.length, 1);
    assert.equal(fixture.saves[0].options.metadata.contentType, "image/webp");
    assert.match(
      image.imageStoragePath,
      /^years\/2026\/semesters\/2\/notice_images\/noticeFixture\/notice-[a-f0-9-]{36}\.webp$/,
    );
    assert.ok(
      image.imageUrl.includes(encodeURIComponent(image.imageStoragePath)),
    );
    assert.ok(
      image.imageUrl.endsWith(
        fixture.saves[0].options.metadata.metadata
          .firebaseStorageDownloadTokens,
      ),
    );
    assert.ok(!image.imageUrl.includes("undefined"));
    await fixture.remove(
      requestFor(uid, { storagePath: image.imageStoragePath }),
    );
    await fixture.remove(requestFor(uid, { storagePath: validPath }));
    assert.equal(fixture.deletions.length, 2);
    assert.deepEqual(fixture.deletions[0].options, { ignoreNotFound: true });
    checks.push(
      `${uid}: approved active-session upload and scoped deletion during maintenance`,
    );
  }
  for (const [format, contentType, extension] of [
    ["png", "image/png", "png"],
    ["jpeg", "image/jpeg", "jpg"],
  ]) {
    const fixture = makeFixture();
    const buffer = await source.clone()[format]().toBuffer();
    const result = await fixture.upload(
      requestFor("teacher", {
        ...validPayload,
        contentType,
        imageBase64: buffer.toString("base64"),
      }),
    );
    assert.equal(result.imageMimeType, contentType);
    assert.ok(result.imageStoragePath.endsWith(`.${extension}`));
    checks.push(`${format}: real decode and correct storage MIME/extension`);
  }
  for (const uid of ["student", "staff", "missing"]) {
    for (const method of ["upload", "remove"]) {
      await rejectsWithoutMutation(
        `${uid}: ${method} denied`,
        (request) => {
          request.auth = requestFor(uid, {}).auth;
        },
        () => {},
        method,
      );
    }
  }
  await rejectsWithoutMutation("unauthenticated denied", (request) => {
    request.auth = undefined;
  });
  await rejectsWithoutMutation("external teacher denied", (request) => {
    request.auth.token.email = "teacher@example.com";
  });
  await rejectsWithoutMutation("missing proof denied", (request) => {
    delete request.data._session;
  });
  await rejectsWithoutMutation("incorrect proof denied", (request) => {
    request.data._session = { ...proof, revision: "b".repeat(64) };
  });
  await rejectsWithoutMutation(
    "expired session denied",
    () => {},
    (fixture) => fixture.expire(),
  );
  await rejectsWithoutMutation(
    "pending registration denied",
    () => {},
    (fixture) =>
      fixture.documents.set("users/teacher", {
        role: "teacher",
        registrationApprovalStatus: "PENDING",
      }),
  );
  await rejectsWithoutMutation(
    "malformed maintenance fails closed",
    () => {},
    (fixture) =>
      fixture.documents.set("site_settings/student_maintenance", {
        enabled: false,
      }),
  );
  await rejectsWithoutMutation(
    "student remains blocked during maintenance",
    (request) => {
      request.auth = requestFor("student", {}).auth;
    },
    (fixture) =>
      fixture.documents.set("site_settings/student_maintenance", maintenance()),
  );
  for (const method of ["upload", "remove"]) {
    await rejectsWithoutMutation(
      `canonical pointer mismatch ${method}`,
      () => {},
      (fixture) =>
        fixture.documents.set("site_settings/semester_active", {
          semesterId: "2027-1",
          revision: 6,
        }),
      method,
    );
    await rejectsWithoutMutation(
      `archived manifest ${method}`,
      () => {},
      (fixture) =>
        (fixture.documents.get("semester_manifests/2026-2").status =
          "ARCHIVED"),
      method,
    );
    await rejectsWithoutMutation(
      `read-only manifest ${method}`,
      () => {},
      (fixture) =>
        (fixture.documents.get("semester_manifests/2026-2").readOnly = true),
      method,
    );
    await rejectsWithoutMutation(
      `manifest revision mismatch ${method}`,
      () => {},
      (fixture) =>
        (fixture.documents.get("semester_manifests/2026-2").revision = 4),
      method,
    );
    await rejectsWithoutMutation(
      `missing canonical manifest ${method}`,
      () => {},
      (fixture) => fixture.documents.delete("semester_manifests/2026-2"),
      method,
    );
    await rejectsWithoutMutation(
      `legacy stale config ${method}`,
      () => {},
      (fixture) => {
        fixture.documents.delete("site_settings/semester_active");
        fixture.documents.get("site_settings/config").semester = "1";
      },
      method,
    );
    await rejectsWithoutMutation(
      `legacy archived manifest ${method}`,
      () => {},
      (fixture) => {
        fixture.documents.delete("site_settings/semester_active");
        fixture.documents.get("semester_manifests/2026-2").status = "ARCHIVED";
      },
      method,
    );
  }
  {
    const fixture = makeFixture();
    fixture.documents.delete("site_settings/semester_active");
    fixture.documents.delete("semester_manifests/2026-2");
    await fixture.upload(requestFor("teacher", validPayload));
    checks.push("legacy config-only current semester remains supported");
  }
  {
    const fixture = makeFixture();
    fixture.documents.get("site_settings/config").semester = "1";
    await fixture.upload(requestFor("teacher", validPayload));
    checks.push("canonical active pointer takes priority over legacy config");
  }
  for (const [field, value] of [
    ["year", "../2026"],
    ["year", 2026],
    ["semester", "3"],
    ["noticeId", "../notice"],
    ["noticeId", "a".repeat(81)],
    ["imageBase64", "not-base64"],
    ["imageBase64", "data:image/webp;base64,AAAA"],
    ["imageBase64", ""],
    ["contentType", "application/octet-stream"],
    ["contentType", "image/png"],
  ]) {
    await rejectsWithoutMutation(
      `invalid ${field}: ${String(value).slice(0, 24)}`,
      (request) => {
        request.data[field] = value;
      },
    );
  }
  await rejectsWithoutMutation(
    "caller cannot supply destination path",
    (request) => {
      request.data.storagePath = validPath;
    },
  );
  await rejectsWithoutMutation("700 KiB rejected before storage", (request) => {
    request.data.imageBase64 = Buffer.alloc(700 * 1024).toString("base64");
  });
  await rejectsWithoutMutation(
    "forged WebP header rejected by decoder",
    (request) => {
      request.data.imageBase64 = Buffer.from(
        "RIFFxxxxWEBPnot-an-image",
      ).toString("base64");
    },
  );
  const png = await source.clone().png().toBuffer();
  await rejectsWithoutMutation("truncated real PNG rejected", (request) => {
    request.data.contentType = "image/png";
    request.data.imageBase64 = png.subarray(0, 45).toString("base64");
  });
  const tooWide = await sharp({
    create: { width: 4097, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await rejectsWithoutMutation("dimension limit enforced", (request) => {
    request.data.contentType = "image/png";
    request.data.imageBase64 = tooWide.toString("base64");
  });
  for (const path of [
    "",
    "notice_images/noticeFixture/notice-1.webp",
    "years/2026/semesters/2/notice_images/../notice-1.webp",
    "years/2026/semesters/2/lesson_pdfs/noticeFixture/notice-1.webp",
    validPath + "/other",
    validPath + "?token=x",
    validPath.replace("notice-1791380553818.webp", "arbitrary.webp"),
    "gs://history-quiz-yongsin.firebasestorage.app/" + validPath,
    validPath.replace("/2/", "/1/"),
  ]) {
    await rejectsWithoutMutation(
      `delete path denied: ${path}`,
      (request) => {
        request.data.storagePath = path;
      },
      () => {},
      "remove",
    );
  }
  for (const callable of [uploadNoticeImageContent, deleteNoticeImageContent]) {
    assert.deepEqual(callable.__endpoint.region, ["asia-northeast3"]);
    assert.ok(callable.__endpoint.callableTrigger);
  }
  const indexSource = readFileSync(resolve(__dirname, "../index.js"), "utf8");
  assert.match(
    indexSource,
    /exports\.uploadNoticeImageContent\s*=\s*require\(['"]\.\/noticeImages['"]\)\.uploadNoticeImageContent/,
  );
  assert.match(
    indexSource,
    /exports\.deleteNoticeImageContent\s*=\s*require\(['"]\.\/noticeImages['"]\)\.deleteNoticeImageContent/,
  );
  checks.push("both guarded callable exports discoverable in asia-northeast3");
  console.log(
    JSON.stringify(
      { passed: true, count: checks.length, network: 0, checks },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
