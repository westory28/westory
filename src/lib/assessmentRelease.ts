import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { type SystemConfig } from "../types";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
  getYearSemester,
} from "./semesterScope";
import {
  getGrade3ClassIdsFromSchoolConfig,
  readAssessmentConfigMap,
} from "./assessmentConfig";
import {
  buildAssessmentDefinitionId,
  executeAssessmentManagementCommand,
  type AssessmentKind,
} from "./assessmentLifecycle";
import { DEFAULT_MOCK_EXAM_ROUND } from "./mockExamRounds";
import { runWisOperation } from "./wisEconomyClient";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type Data = Record<string, any>;
export interface AssessmentReleaseItem {
  definitionId: string;
  title: string;
  kind: AssessmentKind;
  status: "READY" | "PREPARE" | "BLOCKED";
  sourceHash: string;
  itemCount: number;
  reason?: string;
  payload: Data;
  expectedRevision: number;
  fingerprint: string;
}
export interface AssessmentReleasePlan {
  semesterId: string;
  config: { year: string; semester: string };
  items: AssessmentReleaseItem[];
  blockedCount: number;
  prepareCount: number;
}

export const assessmentCanonicalJson = (value: any): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(assessmentCanonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${assessmentCanonicalJson(item)}`,
    )
    .join(",")}}`;
};
const hash = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(assessmentCanonicalJson(value)),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const asIso = (value: any) => {
  if (!value) return "";
  const date =
    typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};
export const getAssessmentSemesterId = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}-${semester}`;
};
const readDefinition = async (definitionId: string) => {
  const snapshot = await getDoc(
    doc(db, "semester_assessment_definitions", definitionId),
  );
  return snapshot.exists() ? snapshot.data() : null;
};
const readSource = async (config: ConfigLike, payload: Data) => {
  if (payload.assessmentKind === "QUIZ") {
    const snapshot = await getDocs(
      collection(db, getSemesterCollectionPath(config, "quiz_questions")),
    );
    const answerKey = snapshot.docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .filter(
        ({ data }) =>
          data.unitId === payload.sourceId &&
          (!payload.category || data.category === payload.category),
      )
      .map(({ id, data }) => ({
        id: String(data.id ?? id).trim(),
        answer: String(data.answer ?? ""),
        sourceRevision: String(
          data.contentRevision ||
            data.revision ||
            data.updatedAt?.toMillis?.() ||
            "legacy",
        ),
      }))
      .filter((item) => item.id && item.answer)
      .sort((a, b) => a.id.localeCompare(b.id));
    return { itemCount: answerKey.length, sourceHash: await hash(answerKey) };
  }
  const snapshot = await getDoc(
    doc(db, getSemesterDocPath(config, "history_classrooms", payload.sourceId)),
  );
  const data = snapshot.data() || {};
  const blanks = Array.isArray(data.blanks)
    ? data.blanks
    : Array.isArray(data.pdfRegions)
      ? data.pdfRegions.flatMap((region: Data) =>
          Array.isArray(region?.blanks) ? region.blanks : [],
        )
      : [];
  const answerKey = blanks
    .map((blank: Data, index: number) => ({
      id: String(blank.id || blank.blankId || `blank-${index + 1}`).trim(),
      answer: String(blank.answer || blank.correctAnswer || ""),
    }))
    .filter((item: Data) => item.id);
  const assignedStudentUids = Array.isArray(data.targetStudentUids)
    ? data.targetStudentUids
        .map((uid: unknown) => String(uid || "").trim())
        .filter(Boolean)
    : data.targetStudentUid
      ? [String(data.targetStudentUid).trim()]
      : [];
  return {
    itemCount:
      data.deletedAt || data.isPublished !== true ? 0 : answerKey.length,
    sourceHash: await hash({ answerKey, assignedStudentUids }),
  };
};

export const buildQuizDefinitionPayload = (
  config: ConfigLike,
  sourceId: string,
  category: string,
  examRound: string,
  title: string,
  legacyConfigKey: string,
  presentationSettings: Data,
) => ({
  definitionId: buildAssessmentDefinitionId(
    getAssessmentSemesterId(config),
    "QUIZ",
    sourceId,
    category,
    examRound,
  ),
  semesterId: getAssessmentSemesterId(config),
  assessmentKind: "QUIZ",
  sourceId,
  category,
  examRound,
  title,
  questionCount: presentationSettings.questionCount,
  durationSeconds: presentationSettings.timeLimit,
  maxAttempts: presentationSettings.allowRetake ? 20 : 1,
  cooldownMinutes: presentationSettings.cooldown,
  opensAt: "",
  closesAt: "",
  assignedClassIds: presentationSettings.visibleClassIds,
  legacyConfigKey,
  presentationSettings,
});
const historyPayload = (config: ConfigLike, sourceId: string, data: Data) => ({
  definitionId: buildAssessmentDefinitionId(
    getAssessmentSemesterId(config),
    "HISTORY_CLASSROOM",
    sourceId,
  ),
  semesterId: getAssessmentSemesterId(config),
  assessmentKind: "HISTORY_CLASSROOM",
  sourceId,
  title: String(data.title || "역사교실"),
  durationSeconds: Math.max(60, Number(data.timeLimitMinutes) * 60 || 3600),
  maxAttempts: 20,
  cooldownMinutes: Math.max(0, Number(data.cooldownMinutes) || 0),
  opensAt: "",
  closesAt: asIso(data.dueAt),
  assignedClassIds: [],
});
const buildItem = async (
  config: ConfigLike,
  payload: Data,
): Promise<AssessmentReleaseItem> => {
  const [source, current] = await Promise.all([
    readSource(config, payload),
    readDefinition(payload.definitionId),
  ]);
  const reason = !source.itemCount
    ? "문항과 정답이 없습니다."
    : payload.questionCount > source.itemCount
      ? `문항 ${source.itemCount}개보다 출제 수가 많습니다.`
      : payload.assessmentKind === "QUIZ" && !payload.assignedClassIds.length
        ? "공개할 학급을 선택해 주세요."
        : current?.status === "CLOSED"
          ? "종료된 평가입니다."
          : payload.closesAt && Date.parse(payload.closesAt) <= Date.now()
            ? "제출 기한이 지났습니다."
            : undefined;
  if (current?.title) payload = { ...payload, title: current.title };
  const matches =
    current?.sourceHash === source.sourceHash &&
    current?.status === "PUBLISHED" &&
    [
      "title",
      "durationSeconds",
      "maxAttempts",
      "cooldownMinutes",
      "opensAt",
      "closesAt",
    ].every((key) => current?.[key] === payload[key]) &&
    Number(current?.questionCount || 0) ===
      Number(payload.questionCount || 0) &&
    (payload.assessmentKind !== "QUIZ" ||
      assessmentCanonicalJson(current?.presentationSettings) ===
        assessmentCanonicalJson(payload.presentationSettings));
  return {
    definitionId: payload.definitionId,
    title: payload.title,
    kind: payload.assessmentKind,
    status: reason ? "BLOCKED" : matches ? "READY" : "PREPARE",
    ...source,
    ...(reason ? { reason } : {}),
    payload,
    expectedRevision: Number(current?.revision || 0),
    fingerprint: await hash({
      payload,
      source,
      revision: Number(current?.revision || 0),
    }),
  };
};

export const planCurrentAssessmentRelease = async (
  config: ConfigLike,
): Promise<AssessmentReleasePlan> => {
  const resolved = getYearSemester(config);
  const [gradeClasses, history] = await Promise.all([
    getGrade3ClassIdsFromSchoolConfig(),
    getDocs(
      collection(db, getSemesterCollectionPath(resolved, "history_classrooms")),
    ),
  ]);
  const settings = await readAssessmentConfigMap(resolved, gradeClasses);
  const payloads: Data[] = [];
  for (const [key, entry] of Object.entries(settings)) {
    if (!entry.active) continue;
    const parsed = key.match(
      /^(.*)_(diagnostic|formative|exam_prep)(?:__(round_\d+))?$/,
    );
    if (!parsed) continue;
    const [, sourceId, category, rawRound] = parsed;
    if (
      category === "exam_prep" &&
      !rawRound &&
      settings[`${key}__${DEFAULT_MOCK_EXAM_ROUND}`]
    )
      continue;
    const { hasExplicitClassVisibility: _visibility, ...presentationSettings } =
      entry;
    const cleanSettings = {
      ...Object.fromEntries(
        Object.entries(presentationSettings).filter(
          ([, value]) => value !== undefined,
        ),
      ),
      visibilityVersion: 2,
    };
    payloads.push(
      buildQuizDefinitionPayload(
        resolved,
        sourceId,
        category,
        category === "exam_prep" ? rawRound || DEFAULT_MOCK_EXAM_ROUND : "",
        `${sourceId} ${category === "diagnostic" ? "진단평가" : category === "formative" ? "형성평가" : "모의고사"}${rawRound ? ` ${rawRound}` : ""}`,
        key,
        cleanSettings,
      ),
    );
  }
  for (const document of history.docs) {
    const data = document.data();
    if (
      !data.deletedAt &&
      data.isPublished === true &&
      (!asIso(data.dueAt) || Date.parse(asIso(data.dueAt)) > Date.now())
    )
      payloads.push(historyPayload(resolved, document.id, data));
  }
  const items = await Promise.all(
    payloads.map((payload) => buildItem(resolved, payload)),
  );
  return {
    semesterId: getAssessmentSemesterId(resolved),
    config: resolved,
    items,
    blockedCount: items.filter((item) => item.status === "BLOCKED").length,
    prepareCount: items.filter((item) => item.status === "PREPARE").length,
  };
};

// Every write has a command receipt. A stale preview must be reviewed again.
export const prepareCurrentAssessmentRelease = async (
  plan: AssessmentReleasePlan,
) => {
  const currentConfig = await getDoc(doc(db, "site_settings", "config"));
  if (
    getAssessmentSemesterId(currentConfig.data() as ConfigLike) !==
    plan.semesterId
  )
    throw new Error(
      "현재 학기가 바뀌었습니다. 준비 목록을 다시 확인해 주세요.",
    );
  const fresh = await planCurrentAssessmentRelease(plan.config);
  if (
    fresh.items.length !== plan.items.length ||
    fresh.items.some(
      (item) =>
        item.fingerprint !==
        plan.items.find(
          (candidate) => candidate.definitionId === item.definitionId,
        )?.fingerprint,
    )
  )
    throw new Error(
      "평가 자료나 설정이 바뀌었습니다. 준비 목록을 다시 확인해 주세요.",
    );
  if (fresh.blockedCount)
    throw new Error("준비할 수 없는 평가를 먼저 수정해 주세요.");
  const results = [];
  for (const item of fresh.items.filter((entry) => entry.status === "PREPARE"))
    results.push(
      await saveAssessmentDefinition(plan.config, item.payload, true, item),
    );
  return { preparedCount: results.length, results };
};

export const saveAssessmentDefinition = async (
  config: ConfigLike,
  payload: Data,
  published: boolean,
  preview?: AssessmentReleaseItem,
) => {
  let current = await readDefinition(payload.definitionId);
  if (preview && Number(current?.revision || 0) !== preview.expectedRevision)
    throw new Error("평가가 변경되었습니다. 다시 확인해 주세요.");
  if (!published) {
    if (current?.status === "PUBLISHED") {
      await executeAssessmentManagementCommand(
        "transitionAssessmentDefinition",
        {
          definitionId: payload.definitionId,
          expectedRevision: current.revision,
          targetStatus: "PAUSED",
          reason: "학생 응시 일시 중지",
        },
      );
      current = await readDefinition(payload.definitionId);
    }
    // Unpublished History sources intentionally cannot become definitions.
    if (payload.assessmentKind === "HISTORY_CLASSROOM")
      return {
        definitionId: payload.definitionId,
        status: current?.status || "DRAFT",
      };
  }
  const source = await readSource(config, payload);
  if (
    !source.itemCount ||
    Number(payload.questionCount || 0) > source.itemCount
  )
    throw new Error("출제 문항 수와 정답을 확인해 주세요.");
  if (preview && source.sourceHash !== preview.sourceHash)
    throw new Error("평가 문항이 바뀌었습니다. 다시 확인해 주세요.");
  if (current?.status === "PUBLISHED") {
    const paused = await executeAssessmentManagementCommand<Data>(
      "transitionAssessmentDefinition",
      {
        definitionId: payload.definitionId,
        expectedRevision: current.revision,
        targetStatus: "PAUSED",
        reason: "평가 변경 적용",
      },
    );
    current = { ...current, ...paused };
  }
  const result = current
    ? await executeAssessmentManagementCommand<Data>(
        "updateAssessmentDefinition",
        {
          ...payload,
          expectedRevision: current.revision,
          reason: "평가 운영 설정 변경",
        },
      )
    : await executeAssessmentManagementCommand<Data>(
        "createAssessmentDefinition",
        payload,
      );
  const saved = result.definition || result;
  if (saved.sourceHash !== source.sourceHash)
    throw new Error("저장 중 평가 문항이 바뀌었습니다. 다시 저장해 주세요.");
  const latestSource = await readSource(config, payload);
  if (latestSource.sourceHash !== saved.sourceHash)
    throw new Error(
      "평가 문항이 바뀌어 공개하지 않았습니다. 다시 저장해 주세요.",
    );
  if (published && saved.status !== "PUBLISHED")
    return executeAssessmentManagementCommand<Data>(
      "transitionAssessmentDefinition",
      {
        definitionId: payload.definitionId,
        expectedRevision: saved.revision,
        targetStatus: "PUBLISHED",
        reason: "학생 응시 공개",
      },
    );
  return saved;
};

export const saveQuizAssessmentSettings = (
  config: ConfigLike,
  sourceId: string,
  category: string,
  examRound: string,
  title: string,
  key: string,
  settings: Data,
) =>
  saveAssessmentDefinition(
    config,
    buildQuizDefinitionPayload(
      config,
      sourceId,
      category,
      examRound,
      title,
      key,
      settings,
    ),
    settings.active === true,
  );

export const syncHistoryAssessmentDefinition = async (
  config: ConfigLike,
  sourceId: string,
  data: Data,
) =>
  saveAssessmentDefinition(
    config,
    historyPayload(config, sourceId, data),
    data.isPublished === true,
  );

export const refreshPublishedQuizDefinitions = async (
  config: ConfigLike,
  sourceId: string,
  category: string,
) => {
  const plan = await planCurrentAssessmentRelease(config);
  const items = plan.items.filter(
    (item) =>
      item.kind === "QUIZ" &&
      item.payload.sourceId === sourceId &&
      item.payload.category === category,
  );
  for (const item of items) {
    if (item.status === "BLOCKED") throw new Error(item.reason);
    if (item.status === "PREPARE")
      await saveAssessmentDefinition(config, item.payload, true, item);
  }
};

export const readAssessmentContentRevision = async (
  config: ConfigLike,
  collectionName: string,
  id: string,
) => {
  const snapshot = await getDoc(
    doc(db, getSemesterDocPath(config, collectionName, id)),
  );
  return Number(snapshot.data()?.contentRevision || 0);
};

export const toAssessmentHistorySource = (payload: Data) => {
  const source = { ...payload };
  for (const key of [
    "id",
    "contentRevision",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "deletedByUid",
  ])
    delete source[key];
  for (const key of ["publishedAt", "dueAt"])
    if (key in source) source[key] = asIso(source[key]) || null;
  if (source.retryResetByStudentUid)
    source.retryResetByStudentUid = Object.fromEntries(
      Object.entries(source.retryResetByStudentUid).map(([uid, value]) => [
        uid,
        asIso(value),
      ]),
    );
  return source;
};

export const saveHistoryAssessmentSource = async (
  config: ConfigLike,
  sourceId: string,
  payload: Data,
  expectedRevision: number,
) =>
  runWisOperation(
    [
      "history-source-save",
      getAssessmentSemesterId(config),
      sourceId,
      expectedRevision,
      toAssessmentHistorySource(payload),
    ],
    true,
    async (step) => {
      // Close admission before changing/removing a source, then refresh its definition.
      await saveAssessmentDefinition(
        config,
        historyPayload(config, sourceId, payload),
        false,
      );
      const saved = await step("source", async () => ({
        commandType: "upsertHistoryClassroomSource",
        payload: {
          semesterId: getAssessmentSemesterId(config),
          sourceId,
          source: toAssessmentHistorySource(payload),
          expectedRevision,
          reason: "교사 역사교실 과제 저장",
        },
      }));
      await syncHistoryAssessmentDefinition(config, sourceId, payload);
      return saved as { contentRevision: number };
    },
  );

export const deleteHistoryAssessmentSource = async (
  config: ConfigLike,
  sourceId: string,
  payload: Data,
  expectedRevision: number,
) => {
  await saveAssessmentDefinition(
    config,
    historyPayload(config, sourceId, payload),
    false,
  );
  return executeAssessmentManagementCommand("deleteHistoryClassroomSource", {
    semesterId: getAssessmentSemesterId(config),
    sourceId,
    expectedRevision,
    reason: "교사 역사교실 과제 삭제",
  });
};
