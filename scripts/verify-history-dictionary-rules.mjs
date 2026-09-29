import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
const env = await initializeTestEnvironment({
  projectId: "demo-westory-dictionary",
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const root = "years/2026/semesters/2";
const words = (uid) =>
  `${root}/dictionary_students/${uid}/history_dictionary_words`;
const student = env
  .authenticatedContext("student", { email: "student@yongshin-ms.ms.kr" })
  .firestore();
const teacher = env
  .authenticatedContext("teacher", { email: "teacher@yongshin-ms.ms.kr" })
  .firestore();
try {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await Promise.all([
      setDoc(doc(db, "users/student"), {
        role: "student",
        teacherPortalEnabled: false,
        staffPermissions: [],
      }),
      setDoc(doc(db, "users/teacher"), { role: "teacher" }),
      setDoc(doc(db, `${words("student")}/one`), {
        uid: "student",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${words("other")}/one`), { uid: "other", updatedAt: 1 }),
      setDoc(doc(db, `${root}/history_dictionary_terms/public`), {
        normalizedWord: "역사",
        status: "published",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${root}/history_dictionary_terms/draft`), {
        normalizedWord: "역사",
        status: "draft",
        updatedAt: 1,
      }),
      setDoc(doc(db, `${root}/history_dictionary_requests/other`), {
        uid: "other",
        updatedAt: 1,
      }),
    ]);
  });
  await assertSucceeds(
    getDocs(
      query(
        collection(student, words("student")),
        orderBy("updatedAt", "desc"),
        limit(20),
      ),
    ),
  );
  await assertFails(
    getDocs(
      query(
        collection(student, words("other")),
        orderBy("updatedAt", "desc"),
        limit(20),
      ),
    ),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(student, `${root}/history_dictionary_terms`),
        where("normalizedWord", "==", "역사"),
        where("status", "==", "published"),
        limit(1),
      ),
    ),
  );
  await assertFails(
    getDoc(doc(student, `${root}/history_dictionary_terms/draft`)),
  );
  await assertFails(
    getDocs(collection(student, `${root}/history_dictionary_requests`)),
  );
  await assertSucceeds(
    getDocs(collection(teacher, `${root}/history_dictionary_terms`)),
  );
  await assertSucceeds(
    getDocs(collection(teacher, `${root}/history_dictionary_requests`)),
  );
  await assertSucceeds(getDocs(collection(teacher, words("other"))));
  await assertFails(
    getDocs(
      collection(env.unauthenticatedContext().firestore(), words("student")),
    ),
  );
  for (const db of [student, teacher])
    for (const path of [
      `${words("student")}/one`,
      `${root}/history_dictionary_terms/public`,
      `${root}/history_dictionary_requests/other`,
    ]) {
      await assertFails(
        setDoc(doc(db, path), { uid: "student", status: "published" }),
      );
      await assertFails(deleteDoc(doc(db, path)));
    }
  console.log(
    "PASS dictionary: own query, public search, teacher reads, other-user/draft/anonymous denial, all client writes denied",
  );
} finally {
  await env.cleanup();
}
