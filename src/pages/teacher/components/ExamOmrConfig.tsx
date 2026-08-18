import React, { useEffect, useState } from "react";
import { db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../../../contexts/AuthContext";
import { getSemesterDocPath } from "../../../lib/semesterScope";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { saveLegacyGradeConfig } from "../../../lib/legacyGradeEvidenceAdapter";

interface ObjectiveItem {
  score: number;
  answer: number;
}

interface SubjectiveSubItem {
  score: number;
  answer: string;
}

interface SubjectiveItem {
  subItems: SubjectiveSubItem[];
}

const ANSWER_RELEASE_POLICY_VERSION = "w6b-answer-release-v1";

const ExamOmrConfig: React.FC = () => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [objective, setObjective] = useState<ObjectiveItem[]>([]);
  const [subjective, setSubjective] = useState<SubjectiveItem[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [releaseStatus, setReleaseStatus] = useState<"HIDDEN" | "RELEASED">(
    "HIDDEN",
  );

  useEffect(() => {
    void loadConfig();
  }, [config]);

  const loadConfig = async () => {
    setLoadState("loading");
    try {
      const snap = await getDoc(
        doc(db, getSemesterDocPath(config, "exam_config", "final_exam")),
      );
      if (snap.exists()) {
        const d = snap.data();
        setObjective(d.objective || []);
        setSubjective(d.subjective || []);
        setReleaseStatus(
          d.releaseStatus === "RELEASED" ? "RELEASED" : "HIDDEN",
        );
        setRevision(Math.max(0, Number(d.revision || 0)));
      } else {
        setObjective([]);
        setSubjective([]);
        setReleaseStatus("HIDDEN");
        setRevision(0);
      }
      setLoadState("ready");
    } catch (e) {
      console.error(e);
      setLoadState("error");
    }
  };

  const handleSave = async () => {
    if (loadState !== "ready") {
      showToast({
        tone: "error",
        title: "설정을 먼저 불러와 주세요.",
        message: "기존 답안 설정을 확인하기 전에는 저장할 수 없습니다.",
      });
      return;
    }
    setSaving(true);
    try {
      const result = await saveLegacyGradeConfig({
        config,
        scoreKind: "written_exam_essay",
        configKind: "OMR",
        configId: "final_exam",
        expectedRevision: revision,
        operation: "UPSERT",
        data: {
          objective,
          subjective,
          releaseStatus,
          releasePolicyVersion: ANSWER_RELEASE_POLICY_VERSION,
        },
        reason: "정기시험 답안 설정 저장",
      });
      setRevision(result.revision);
      showToast({
        tone: "success",
        title: "저장되었습니다.",
        message: "정기시험 답안 설정을 업데이트했습니다.",
      });
    } catch (error) {
      console.error(error);
      showToast({
        tone: "error",
        title: "저장하지 못했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "정기시험 답안 설정을 다시 확인해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const getTotals = () => {
    let score = 0;
    let count = 0;
    objective.forEach((i) => {
      score += i.score;
      count++;
    });
    subjective.forEach((p) =>
      p.subItems.forEach((i) => {
        score += i.score;
        count++;
      }),
    );
    return { score, count };
  };

  const addObjective = () =>
    setObjective([...objective, { score: 4, answer: 0 }]);
  const removeObjective = (idx: number) =>
    setObjective(objective.filter((_, i) => i !== idx));
  const updateObjective = (
    idx: number,
    field: keyof ObjectiveItem,
    val: any,
  ) => {
    const newObj = [...objective];
    // @ts-ignore
    newObj[idx][field] = val;
    setObjective(newObj);
  };

  const addSubjectiveParent = () =>
    setSubjective([...subjective, { subItems: [] }]);
  const removeSubjectiveParent = (idx: number) =>
    setSubjective(subjective.filter((_, i) => i !== idx));

  const addSubjectiveSub = (pIdx: number) => {
    const newSub = [...subjective];
    newSub[pIdx].subItems.push({ score: 5, answer: "" });
    setSubjective(newSub);
  };

  const updateSubjectiveSub = (
    pIdx: number,
    sIdx: number,
    field: keyof SubjectiveSubItem,
    val: any,
  ) => {
    const newSub = [...subjective];
    // @ts-ignore
    newSub[pIdx].subItems[sIdx][field] = val;
    setSubjective(newSub);
  };

  if (loadState === "loading") {
    return (
      <div className="h-full relative pb-20">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center text-gray-400">
          정기시험 답안 설정을 불러오는 중입니다.
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="h-full relative pb-20">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-red-200 text-center">
          <p className="font-bold text-red-700">
            정기시험 답안 설정을 불러오지 못했습니다.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            기존 설정을 보호하기 위해 저장을 중지했습니다.
          </p>
          <button
            type="button"
            onClick={() => void loadConfig()}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition"
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative pb-20">
      {/* Bottom Floater */}
      <div className="fixed bottom-3 md:bottom-4 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-2xl rounded-2xl px-3 md:px-6 py-2.5 md:py-3 w-[calc(100%-1rem)] max-w-[720px] md:w-auto flex items-center justify-between md:justify-center gap-3 md:gap-4 z-50 animate-fadeUp">
        <div className="flex items-center gap-2 md:gap-3 text-xs md:text-sm font-bold">
          <span className="text-gray-500">총점</span>
          <span className="text-xl md:text-2xl font-extrabold text-blue-600">
            {getTotals().score}
          </span>
          <span className="text-gray-400">점</span>
          <span className="mx-1 text-gray-300">|</span>
          <span className="text-gray-500">문항</span>
          <span className="text-base md:text-lg font-extrabold text-gray-700">
            {getTotals().count}
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 md:px-5 py-2 rounded-xl text-sm transition shadow-md whitespace-nowrap"
        >
          <i className="fas fa-save mr-1"></i>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold text-gray-700">학생 답안 공개</h2>
          <p className="mt-1 text-sm text-gray-500">
            공개로 저장하면 현재 학기 활성 학생이 정답을 확인할 수 있습니다.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 font-bold text-gray-700">
          <input
            type="checkbox"
            checked={releaseStatus === "RELEASED"}
            onChange={(event) =>
              setReleaseStatus(event.target.checked ? "RELEASED" : "HIDDEN")
            }
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          학생에게 공개
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-32">
        {/* Objective */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-6 pb-2 border-b">
            <h2 className="font-bold text-lg text-gray-700">객관식 문항</h2>
            <button
              onClick={addObjective}
              className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded font-bold hover:bg-green-100 border border-green-200"
            >
              + 문항 추가
            </button>
          </div>
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {objective.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-4 bg-gray-50 p-3 rounded border border-gray-100"
              >
                <span className="font-bold text-gray-500 w-8 text-center">
                  {i + 1}
                </span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => updateObjective(i, "answer", n)}
                      className={`w-8 h-8 rounded-full border border-gray-300 font-bold transition flex items-center justify-center ${
                        item.answer === n
                          ? "bg-red-500 text-white border-red-500"
                          : "text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  className="w-16 p-1 text-center border rounded text-sm font-bold text-blue-600"
                  value={item.score}
                  onChange={(e) =>
                    updateObjective(i, "score", Number(e.target.value))
                  }
                />
                <span className="text-xs text-gray-400">점</span>
                <button
                  onClick={() => removeObjective(i)}
                  className="ml-auto text-gray-300 hover:text-red-500"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Subjective */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-6 pb-2 border-b">
            <h2 className="font-bold text-lg text-gray-700">서술형 문항</h2>
            <button
              onClick={addSubjectiveParent}
              className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded font-bold hover:bg-indigo-100 border border-indigo-200"
            >
              + 큰 문항 추가
            </button>
          </div>
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
            {subjective.map((parent, pIdx) => (
              <div
                key={pIdx}
                className="bg-gray-50 p-4 rounded border border-gray-200"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-indigo-600">
                    서술형 {pIdx + 1}번
                  </span>
                  <div className="space-x-2">
                    <button
                      onClick={() => addSubjectiveSub(pIdx)}
                      className="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-50"
                    >
                      + 소문항
                    </button>
                    <button
                      onClick={() => removeSubjectiveParent(pIdx)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {parent.subItems.map((sub, sIdx) => (
                    <div
                      key={sIdx}
                      className="pl-4 border-l-2 border-indigo-100"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-gray-500">
                          ({sIdx + 1})
                        </span>
                        <input
                          type="number"
                          className="w-14 p-1 text-center border rounded text-xs font-bold"
                          value={sub.score}
                          onChange={(e) =>
                            updateSubjectiveSub(
                              pIdx,
                              sIdx,
                              "score",
                              Number(e.target.value),
                            )
                          }
                        />
                        <span className="text-xs text-gray-400">점</span>
                      </div>
                      <textarea
                        className="w-full p-2 border rounded text-sm h-16 resize-none"
                        placeholder="모범 답안 입력"
                        value={sub.answer}
                        onChange={(e) =>
                          updateSubjectiveSub(
                            pIdx,
                            sIdx,
                            "answer",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamOmrConfig;
