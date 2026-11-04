import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  getFirestore,
  orderBy,
  query,
  queryEqual,
  where,
} from "firebase/firestore";
import {
  clientQuery,
  collections,
  kinds,
} from "./score-request-client-fixture.mjs";

const app = initializeApp({ projectId: "demo-westory-score-requests" });
try {
  const db = getFirestore(app);
  assert.deepEqual(collections, [
    "performance_score_objections",
    "performance_score_answer_sheet_requests",
  ]);
  assert.deepEqual(kinds, ["performance", "written_exam_essay"]);
  for (const semester of ["1", "2"]) {
    for (const name of collections) {
      const ref = collection(db, `years/2026/semesters/${semester}/${name}`);
      assert.ok(
        queryEqual(
          clientQuery(db, name, kinds[0], semester),
          query(ref, orderBy("requestedAt", "desc")),
        ),
      );
      assert.ok(
        queryEqual(
          clientQuery(db, name, kinds[1], semester),
          query(ref, where("scoreKind", "==", "written_exam_essay")),
        ),
      );
    }
  }
  console.log(
    "PASS teacher score requests use the semester collections and compatible single-field queries",
  );
} finally {
  await deleteApp(app);
}
