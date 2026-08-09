export const HIGH_RISK_COMMANDS = new Set([
  "deleteStudentData",
  "resetLessonCorePointProgress",
  "updateStudentData",
  "resetAssessmentAttemptsByClass",
  "resetQuizAttemptsForClass",
  "recalculateQuizResultsAfterQuestionCorrection",
  "grantHistoryClassroomExemptions",
  "revokeHistoryClassroomExemptions",
  "reviewHistoryClassroomExemptionRequest",
  "reviewPerformanceScoreObjection",
  "saveWisHallOfFameConfig",
  "rebuildPointWalletRankTotals",
  "adjustTeacherPoints",
  "updateTeacherPointAdjustment",
  "reviewTeacherPointOrder",
  "deleteSourceArchiveAsset",
]);

export const isHighRiskCommand = (commandName: string) =>
  HIGH_RISK_COMMANDS.has(String(commandName || "").trim());
