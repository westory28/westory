const { HttpsError } = require("firebase-functions/v2/https");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const sessionAuthority = require("./sessionAuthority");

// These unscoped academic collections predate semester paths and belong to the
// existing default semester. Existence is evidence only: never create or seed it.
const LEGACY_SEMESTER = { year: "2026", semester: "1" };
const LEGACY_COLLECTIONS = Object.freeze([
  "curriculum", "lessons", "quiz_questions", "quiz_results", "quiz_submissions",
  "history_classrooms", "history_classroom_results", "lesson_progress",
]);
const normalizeOption = (year, semester) => {
  const normalizedYear = String(year ?? "");
  const normalizedSemester = String(semester ?? "");
  if (!/^20\d{2}$|^2100$/.test(normalizedYear) || !["1", "2"].includes(normalizedSemester)) return null;
  return { year: normalizedYear, semester: normalizedSemester,
    label: `${normalizedYear}학년도 ${normalizedSemester}학기` };
};

const createTeacherSemesterOptionsCore = ({
  store, assertSession = sessionAuthority.assertActiveApplicationSession,
} = {}) => {
  if (!store) throw new TypeError("store is required.");
  const getTeacherSemesterOptions = async (request) => {
    if (!request.app) throw new HttpsError("unauthenticated", "App Check is required.");
    const identity = await assertSession(request, { recentAuth: false, highRisk: false });
    if (!identity?.uid || identity.uid !== request.auth?.uid || identity.uid.includes("/"))
      throw new HttpsError("permission-denied", "Authenticated actor mismatch.");
    const isAdmin = String(identity.email || "").toLowerCase() === "westoria28@gmail.com"
      && String(request.auth?.token?.email || "").toLowerCase() === "westoria28@gmail.com";
    if (!isAdmin) {
      const profile = await store.get(`users/${identity.uid}`);
      if (!profile.exists || profile.data?.role !== "teacher"
          || (profile.data?.registrationApprovalStatus ?? "APPROVED") !== "APPROVED")
        throw new HttpsError("permission-denied", "교사만 조회할 학기를 선택할 수 있습니다.");
    }
    const data = request.data ?? {};
    if (typeof data !== "object" || Array.isArray(data)
        || Object.keys(data).some(key => key !== "_session"))
      throw new HttpsError("invalid-argument", "Unsupported semester query.");

    const [config, manifests, yearPaths, legacyExists] = await Promise.all([
      store.get("site_settings/config"),
      store.listManifests(),
      store.listDocumentPaths("years"),
      Promise.all(LEGACY_COLLECTIONS.map(collection => store.hasDocuments(collection))),
    ]);
    const options = new Map();
    const add = (year, semester) => {
      const option = normalizeOption(year, semester);
      if (option) options.set(`${option.year}-${option.semester}`, option);
    };
    add(config.data?.year, config.data?.semester);
    for (const option of Array.isArray(config.data?.availableSemesters) ? config.data.availableSemesters : [])
      add(option?.year, option?.semester);
    for (const manifest of manifests) {
      const match = /^semester_manifests\/(\d{4})-([12])$/.exec(manifest.path);
      if (match) add(match[1], match[2]);
    }
    // listDocuments includes missing ancestor documents that have subcollections.
    // A normal collection query would silently lose those existing semesters.
    const yearIds = [...new Set(yearPaths.map(path => /^years\/(\d{4})$/.exec(path)?.[1])
      .filter(year => normalizeOption(year, "1")))];
    const semesterPaths = await Promise.all(yearIds.map(year => store.listDocumentPaths(`years/${year}/semesters`)));
    for (const path of semesterPaths.flat()) {
      const match = /^years\/(\d{4})\/semesters\/([12])$/.exec(path);
      if (match) add(match[1], match[2]);
    }
    if (legacyExists.some(Boolean)) add(LEGACY_SEMESTER.year, LEGACY_SEMESTER.semester);
    return { semesters: [...options.values()].sort((left, right) =>
      Number(right.year) - Number(left.year) || Number(right.semester) - Number(left.semester)) };
  };
  return { getTeacherSemesterOptions };
};

const createTeacherSemesterOptionsCallable = ({ db }) => {
  const core = createTeacherSemesterOptionsCore({ store: {
    get: async path => {
      const snapshot = await db.doc(path).get();
      return { exists: snapshot.exists, data: snapshot.data(), path };
    },
    listManifests: async () => {
      const snapshot = await db.collection("semester_manifests").select().limit(202).get();
      return snapshot.docs.map(document => ({ path: document.ref.path }));
    },
    listDocumentPaths: async path => (await db.collection(path).listDocuments()).map(ref => ref.path),
    hasDocuments: async path => !(await db.collection(path).select().limit(1).get()).empty,
  } });
  return onCall({ region: "asia-northeast3", enforceAppCheck: true, timeoutSeconds: 60 },
    request => core.getTeacherSemesterOptions(request));
};

module.exports = { LEGACY_COLLECTIONS, normalizeOption,
  createTeacherSemesterOptionsCore, createTeacherSemesterOptionsCallable };
