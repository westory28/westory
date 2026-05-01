import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InlineLoading } from "../../../components/common/LoadingState";
import { db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../../../contexts/AuthContext";
import { getSemesterDocPath } from "../../../lib/semesterScope";
import {
  type AssessmentConfigEntry,
  getAssessmentConfigKey,
  getGrade3ClassIdsFromSchoolConfig,
  isAssessmentVisibleToStudent,
  readAssessmentConfigMap,
} from "../../../lib/assessmentConfig";

interface TreeItem {
  id: string;
  title: string;
  children?: TreeItem[];
}

const QuizIndex: React.FC = () => {
  const { userData, config } = useAuth();
  const navigate = useNavigate();

  const [tree, setTree] = useState<TreeItem[]>([]);
  const [assessmentConfig, setAssessmentConfig] = useState<
    Record<string, AssessmentConfigEntry>
  >({});
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      try {
        let treeDoc = await getDoc(doc(db, getSemesterDocPath(config, "curriculum", "tree")));
        if (!treeDoc.exists()) {
          treeDoc = await getDoc(doc(db, "curriculum", "tree"));
        }
        if (treeDoc.exists() && treeDoc.data().tree) {
          setTree(treeDoc.data().tree);
        }

        const grade3ClassIds = await getGrade3ClassIdsFromSchoolConfig();
        const nextConfig = await readAssessmentConfigMap(config, grade3ClassIds);
        setAssessmentConfig(nextConfig);
      } catch (error) {
        console.error("Error fetching quiz data:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [config]);

  const toggleAccordion = (index: number) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedItems(newSet);
  };

  const startQuiz = (unitId: string, category: string, title: string) => {
    navigate(
      `/student/quiz/run?unitId=${unitId}&category=${category}&title=${encodeURIComponent(title)}`,
    );
  };

  const getVisibility = (unitId: string, category: string) =>
    isAssessmentVisibleToStudent(
      assessmentConfig[getAssessmentConfigKey(unitId, category)],
      userData,
    );

  const isExamPrepActive = getVisibility("exam_prep", "exam_prep");

  if (loading) {
    return (
      <InlineLoading message="퀴즈 목록을 불러오는 중입니다." showWarning />
    );
  }

  return (
    <div className="mx-auto max-w-4xl animate-fadeIn px-4 py-8">
      <section className="mb-10">
        <h2 className="mb-3 ml-1 flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fas fa-flag-checkered text-blue-600"></i> 실전 대비
        </h2>
        <div
          onClick={() =>
            isExamPrepActive &&
            startQuiz("exam_prep", "exam_prep", "정기 시험 대비 실전")
          }
          className={`
            group relative overflow-hidden rounded-2xl p-6 shadow-lg transition-transform duration-200
            ${
              isExamPrepActive
                ? "cursor-pointer bg-gradient-to-br from-blue-800 to-blue-500 text-white hover:scale-[1.01]"
                : "cursor-not-allowed bg-gray-200 text-gray-400"
            }
          `}
        >
          <i
            className={`fas fa-pen-fancy absolute -bottom-5 -right-5 text-8xl opacity-10 -rotate-15 ${
              !isExamPrepActive ? "hidden" : ""
            }`}
          ></i>

          <div className="relative z-10">
            <div
              className={`mb-2 inline-block rounded px-2 py-1 text-[10px] font-bold shadow-sm ${
                isExamPrepActive
                  ? "bg-red-500 text-white"
                  : "bg-gray-400 text-white"
              }`}
            >
              {isExamPrepActive ? "FINAL CHECK" : "비공개"}
            </div>
            <h3 className="mb-1 text-2xl font-black">
              정기 시험 대비 {isExamPrepActive ? "실전 문제" : "(준비중)"}
            </h3>
            <p
              className={`text-sm font-medium ${
                isExamPrepActive ? "text-blue-100 opacity-90" : "text-gray-400"
              }`}
            >
              {isExamPrepActive
                ? "실제 시험처럼 문제를 풀어보고 실력을 점검하세요."
                : "선생님이 평가를 활성화하면 시작할 수 있습니다."}
            </p>
          </div>

          {isExamPrepActive && (
            <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition group-hover:bg-white group-hover:text-blue-600 md:block">
              <i className="fas fa-chevron-right text-xl"></i>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-4 ml-1 flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fas fa-layer-group text-amber-500"></i> 단원별 평가
        </h2>

        <div className="space-y-4">
          {tree.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-20 text-center text-gray-400">
              등록된 단원이 없습니다.
              <br />
              <span className="text-xs">
                선생님이 아직 단원을 등록하지 않았습니다.
              </span>
            </div>
          )}

          {tree.map((big, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-sm"
            >
              <div
                onClick={() => toggleAccordion(idx)}
                className="flex cursor-pointer items-center justify-between bg-white p-5 transition-colors hover:bg-gray-50"
              >
                <span className="text-lg font-extrabold text-gray-800">
                  {big.title}
                </span>
                <i
                  className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${
                    expandedItems.has(idx) ? "rotate-180 text-blue-500" : ""
                  }`}
                ></i>
              </div>

              {expandedItems.has(idx) && (
                <div className="border-t border-gray-100 bg-gray-50">
                  {big.children?.map((mid, mIdx) => {
                    const diagActive = getVisibility(mid.id, "diagnostic");
                    const formActive = getVisibility(mid.id, "formative");

                    return (
                      <div
                        key={mIdx}
                        className="flex flex-col justify-between gap-3 border-b border-gray-200 p-4 last:border-0 md:flex-row md:items-center"
                      >
                        <div className="flex items-center font-semibold text-gray-700">
                          <i className="fas fa-folder mr-3 text-amber-400"></i>
                          {mid.title}
                        </div>
                        <div className="flex gap-2 self-end md:self-auto">
                          <button
                            onClick={() =>
                              diagActive &&
                              startQuiz(mid.id, "diagnostic", mid.title)
                            }
                            disabled={!diagActive}
                            className={`
                              flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
                              ${
                                diagActive
                                  ? "border-blue-100 bg-blue-50 text-blue-600 hover:border-blue-600 hover:bg-blue-600 hover:text-white"
                                  : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                              }
                            `}
                          >
                            {diagActive ? (
                              <i className="fas fa-stethoscope"></i>
                            ) : (
                              <i className="fas fa-lock"></i>
                            )}
                            {diagActive ? "진단평가" : "진단"}
                          </button>

                          <button
                            onClick={() =>
                              formActive &&
                              startQuiz(mid.id, "formative", mid.title)
                            }
                            disabled={!formActive}
                            className={`
                              flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
                              ${
                                formActive
                                  ? "border-emerald-100 bg-emerald-50 text-emerald-600 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white"
                                  : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                              }
                            `}
                          >
                            {formActive ? (
                              <i className="fas fa-pencil-alt"></i>
                            ) : (
                              <i className="fas fa-lock"></i>
                            )}
                            {formActive ? "형성평가" : "형성"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default QuizIndex;
