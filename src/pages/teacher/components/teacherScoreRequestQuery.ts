import {
  collection,
  type Firestore,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  type PerformanceScoreKind,
  WRITTEN_EXAM_SCORE_KIND,
} from "../../../lib/performanceScores";

export const getTeacherScoreRequestQuery = (
  db: Firestore,
  collectionPath: string,
  scoreKind: PerformanceScoreKind,
) =>
  query(
    collection(db, collectionPath),
    scoreKind === WRITTEN_EXAM_SCORE_KIND
      ? where("scoreKind", "==", scoreKind)
      : orderBy("requestedAt", "desc"),
  );
