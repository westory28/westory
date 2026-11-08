const ROUNDS = Object.freeze(["round_1", "round_2", "round_3"]);
const RESULT_FIELDS = ["studentUid", "semesterId", "definitionId"];

const roundFor = (assessment) => {
  if (assessment?.assessmentKind !== "QUIZ") return "";
  const category = String(assessment.category || String(assessment.definitionId || "").split(":")[3] || "");
  if (category !== "exam_prep" && !/^exam_prep__round_[1-3]$/.test(category)) return "";
  const round = assessment.examRound || category.split("__")[1]
    || String(assessment.definitionId || "").split(":")[4] || "round_1";
  return ROUNDS.includes(round) ? round : "";
};

// Results are immutable, server-owned submissions. Read only this student's
// exact semester/round, never their full history or another student's records.
const completedRound = async (transaction, semesterId, studentUid, examRound, sourceId = "exam_prep") => {
  const definitionId = `quiz:${semesterId}:${sourceId}:exam_prep:${examRound}`;
  const canonical = await transaction.query("semester_assessment_results", {
    filters: [
      { field: "semesterId", operator: "==", value: semesterId },
      { field: "studentUid", operator: "==", value: studentUid },
      { field: "definitionId", operator: "==", value: definitionId },
    ],
    limit: 1, fieldMask: RESULT_FIELDS,
  });
  if (canonical.some(({ data }) => data?.studentUid === studentUid
    && data.semesterId === semesterId && data.definitionId === definitionId)) return true;

  // Preserve explicitly round-tagged pre-canonical results. Untagged old
  // practice cannot establish which authored round the student completed.
  const [year, semester] = semesterId.split("-");
  const collection = `years/${year}/semesters/${semester}/quiz_results`;
  const common = [
    { field: "uid", operator: "==", value: studentUid },
    { field: "unitId", operator: "==", value: sourceId },
  ];
  const legacy = await transaction.query(collection, {
    filters: [...common,
      { field: "category", operator: "==", value: "exam_prep" },
      { field: "examRound", operator: "==", value: examRound },
    ],
    limit: 1, fieldMask: ["uid", "unitId", "category", "examRound"],
  });
  if (legacy.some(({ data }) => data?.uid === studentUid && data.unitId === sourceId
    && data.category === "exam_prep" && data.examRound === examRound)) return true;
  const encoded = await transaction.query(collection, {
    filters: [...common, { field: "category", operator: "==", value: `exam_prep__${examRound}` }],
    limit: 1, fieldMask: ["uid", "unitId", "category"],
  });
  return encoded.some(({ data }) => data?.uid === studentUid && data.unitId === sourceId
    && data.category === `exam_prep__${examRound}`);
};

const requiredRound = async (transaction, assessment, studentUid) => {
  const round = roundFor(assessment);
  const index = ROUNDS.indexOf(round);
  const identity = String(assessment?.definitionId || "").split(":");
  for (const prior of ROUNDS.slice(0, Math.max(0, index))) {
    if (!await completedRound(transaction, assessment.semesterId || identity[1], studentUid, prior, assessment.sourceId || identity[2] || "exam_prep")) return prior;
  }
  return "";
};

const overview = async (transaction, semesterId, studentUid) => {
  const completed = await Promise.all(ROUNDS.map(round => completedRound(transaction, semesterId, studentUid, round)));
  return ROUNDS.map((examRound, index) => {
    const missing = completed.slice(0, index).findIndex(value => !value);
    return { examRound, completed: completed[index], prerequisiteMet: missing < 0,
      requiredRound: missing < 0 ? "" : ROUNDS[missing] };
  });
};

module.exports = { roundFor, requiredRound, overview };
