import {
  doc,
  getDocFromServer,
  type DocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { normalizeStaffPermissions } from "./permissions";
import { getSemesterDocPath } from "./semesterScope";
import type { UserData } from "../types";

type Config = Parameters<typeof getSemesterDocPath>[0];
type Context = { uid: string; key: string };
const TTL_MS = 30_000;
const cache = new Map<
  string,
  { snapshot: DocumentSnapshot; expiresAt: number }
>();
const flights = new Map<string, Promise<DocumentSnapshot>>();
let activeContext = "";

export const teacherCurriculumContext = (
  uid: string | undefined,
  generation: number,
  userData: Partial<UserData> | null | undefined,
): Context => ({
  uid: uid || "",
  key: JSON.stringify([
    uid || "",
    generation,
    userData?.role,
    userData?.teacherPortalEnabled === true,
    normalizeStaffPermissions(userData?.staffPermissions).sort(),
  ]),
});

// Only curriculum metadata is shared between teacher pages. No student-visible
// publication state or lesson content is cached. Writes invalidate both trees.
export const readTeacherCurriculumDocument = async (
  config: Config,
  context: Context,
  options: { legacy?: boolean; force?: boolean } = {},
): Promise<DocumentSnapshot> => {
  const assertOwner = () => {
    if (!context.uid || auth.currentUser?.uid !== context.uid)
      throw new Error("로그인 상태를 확인한 뒤 목차를 다시 불러와 주세요.");
  };
  assertOwner();
  if (activeContext !== context.key) {
    activeContext = context.key;
    cache.clear();
    flights.clear();
  }
  const path = options.legacy
    ? "curriculum/tree"
    : getSemesterDocPath(config, "curriculum", "tree");
  for (const [key, entry] of cache)
    if (entry.expiresAt <= Date.now()) cache.delete(key);
  if (options.force) cache.delete(path);
  const cached = cache.get(path);
  if (cached) return cached.snapshot;
  const existing = flights.get(path);
  if (existing) return existing;
  const flight = getDocFromServer(doc(db, path)).then((snapshot) => {
    assertOwner();
    if (activeContext !== context.key)
      throw new Error(
        "로그인 권한이 변경되었습니다. 목차를 다시 불러와 주세요.",
      );
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      throw new Error("목차의 저장 상태를 확인하지 못했습니다.");
    if (flights.get(path) === flight)
      cache.set(path, { snapshot, expiresAt: Date.now() + TTL_MS });
    return snapshot;
  });
  flights.set(path, flight);
  try {
    return await flight;
  } finally {
    if (flights.get(path) === flight) flights.delete(path);
  }
};

export const invalidateTeacherCurriculum = (config: Config) => {
  for (const path of [
    getSemesterDocPath(config, "curriculum", "tree"),
    "curriculum/tree",
  ]) {
    cache.delete(path);
    flights.delete(path);
  }
};
