import React, { useEffect, useState, useRef } from "react";
import { db } from "../../../lib/firebase";
import {
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import ScoreCard from "./components/ScoreCard";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import { lazyWithRetry } from "../../../lib/lazyWithRetry";
import {
  loadLegacyScoreDraft,
  loadLegacyScoreWarningAcknowledgement,
  saveLegacyScoreDraft,
  saveLegacyScoreWarningAcknowledgement,
} from "../../../lib/legacyScoreCalculatorAdapter";
import {
  getAchievementColor,
  getSubjectPriorityIndex,
} from "../../../lib/studentScores";

const GradeChart = lazyWithRetry(
  () => import("./components/GradeChart"),
  "student-score-grade-chart",
);

interface GradingPlan {
  id: string;
  subject: string;
  items: any[];
  targetGrade?: string;
  academicYear?: string;
  semester?: string;
  createdAt?: any;
}

const getLocalDraftErrorMessage = () =>
  "이 브라우저에 임시 저장하지 못했습니다. 브라우저 저장 공간과 개인정보 보호 설정을 확인해 주세요.";

const ScoreDashboard: React.FC = () => {
  const { userData, currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const { year: activeYear, semester: activeSemester } =
    getYearSemester(config);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<GradingPlan[]>([]);
  const [userScores, setUserScores] = useState<{ [key: string]: string }>({});
  const [saving, setSaving] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [agree, setAgree] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [warningSaving, setWarningSaving] = useState(false);
  const [warningAcknowledgedLocal, setWarningAcknowledgedLocal] =
    useState(false);
  const [warningAcknowledgementReady, setWarningAcknowledgementReady] =
    useState(false);
  const hasHydratedUserDoc = userData?.uid === currentUser?.uid;

  // Filters
  const [semester, setSemester] = useState(activeSemester);
  const [grade, setGrade] = useState(userData?.grade || "1");
  const [sortMode, setSortMode] = useState("importance");

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const didInitDefaultsRef = useRef(false);

  const persistDraftScores = (
    targetSemester: string,
    scoresToDraft: { [key: string]: string },
  ) => {
    const uid = currentUser?.uid || userData?.uid;
    if (!uid) return null;
    try {
      return saveLegacyScoreDraft(
        window.localStorage,
        { uid, year: activeYear, semester: targetSemester },
        scoresToDraft,
      );
    } catch (error) {
      console.error("Failed to persist temporary scores:", error);
      return null;
    }
  };

  const loadDraftScores = (
    targetSemester: string,
  ): { [key: string]: string } => {
    const uid = currentUser?.uid || userData?.uid;
    if (!uid) return {};
    try {
      return loadLegacyScoreDraft(window.localStorage, {
        uid,
        year: activeYear,
        semester: targetSemester,
      }).scores;
    } catch (error) {
      console.error("Failed to load temporary scores:", error);
      return {};
    }
  };

  useEffect(() => {
    if (!userData || didInitDefaultsRef.current) return;
    setSemester(activeSemester);
    setGrade(userData.grade || "1");
    setSortMode("importance");
    didInitDefaultsRef.current = true;
  }, [userData, activeSemester]);

  useEffect(() => {
    setWarningAcknowledgementReady(false);
    if (!currentUser?.uid) {
      setWarningAcknowledgedLocal(false);
      setWarningAcknowledgementReady(true);
      return;
    }
    try {
      setWarningAcknowledgedLocal(
        loadLegacyScoreWarningAcknowledgement(
          window.localStorage,
          currentUser.uid,
        ),
      );
    } catch (error) {
      console.error("Failed to load score warning acknowledgement:", error);
      setWarningAcknowledgedLocal(false);
    } finally {
      setWarningAcknowledgementReady(true);
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    if (currentUser?.uid) {
      fetchData(semester);
      return;
    }
    setLoading(false);
  }, [currentUser?.uid, activeYear, semester]);

  useEffect(() => {
    if (
      !currentUser?.uid ||
      !hasHydratedUserDoc ||
      !warningAcknowledgementReady
    ) {
      setShowWarning(false);
      setAgree(false);
      return;
    }

    const warningAcknowledged =
      warningAcknowledgedLocal || userData?.scoreWarningAcknowledged === true;
    setShowWarning(!warningAcknowledged);
    setAgree(warningAcknowledged);
  }, [
    currentUser?.uid,
    hasHydratedUserDoc,
    warningAcknowledgementReady,
    userData?.scoreWarningAcknowledged,
    warningAcknowledgedLocal,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lastSavedAt) return;
    const timer = window.setTimeout(() => setLastSavedAt(null), 2000);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      persistDraftScores(semester, userScores);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistDraftScores(semester, userScores);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeYear, currentUser?.uid, semester, userData?.uid, userScores]);

  const fetchData = async (targetSemester: string = semester) => {
    setLoading(true);
    try {
      // 1. Fetch Plans
      const snap = await getDocs(
        query(
          collection(
            db,
            getSemesterCollectionPath(
              { year: activeYear, semester: targetSemester },
              "grading_plans",
            ),
          ),
          orderBy("createdAt", "desc"),
        ),
      );
      const loadedPlans: GradingPlan[] = [];
      snap.forEach((d) =>
        loadedPlans.push({ id: d.id, ...d.data() } as GradingPlan),
      );
      setPlans(loadedPlans);

      // 2. Fetch User Scores
      const scoreDocId = `${activeYear}_${targetSemester}`;
      // IMPORTANT: Based on previous logic, scores are stored under users/{uid}/academic_records/{scoreDocId}
      if (currentUser?.uid) {
        const scoreRef = doc(
          db,
          "users",
          currentUser.uid,
          "academic_records",
          scoreDocId,
        );
        const scoreSnap = await getDoc(scoreRef);
        const remoteScores = scoreSnap.exists()
          ? scoreSnap.data().scores || {}
          : {};
        const draftScores = loadDraftScores(targetSemester);
        const mergedScores = { ...remoteScores, ...draftScores };
        setUserScores(mergedScores);
      }
    } catch (error) {
      console.error("Error loading score data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleScoreChange = (planId: string, idx: number, val: string) => {
    const numVal = parseFloat(val);
    // Find max score for validation
    const plan = plans.find((p) => p.id === planId);
    const item = plan?.items[idx];
    let finalVal = val;

    if (item && !isNaN(numVal)) {
      if (numVal > item.maxScore) finalVal = item.maxScore.toString();
      if (numVal < 0) finalVal = "0";
    }

    const key = `${planId}_${idx}`;
    const newScores = { ...userScores, [key]: finalVal };
    setUserScores(newScores);
    setSaveError(null);
    if (persistDraftScores(semester, newScores) === null) {
      setSaveError(getLocalDraftErrorMessage());
    }

    // Debounce Save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    const semesterForSave = semester;
    saveTimeoutRef.current = setTimeout(async () => {
      await saveScores(newScores, semesterForSave);
      setSaving(false);
    }, 1000);
  };

  const saveScores = async (
    scoresToSave: { [key: string]: string },
    targetSemester: string = semester,
    options?: { announce?: boolean },
  ) => {
    if (!currentUser?.uid) return;
    try {
      const savedAt = persistDraftScores(targetSemester, scoresToSave);
      if (savedAt === null) throw new Error("Local score draft save failed.");
      setLastSavedAt(savedAt);
      setSaveError(null);
      if (options?.announce) {
        showToast({
          tone: "success",
          title: "성적 계산기가 임시 저장되었습니다.",
          message: `${activeYear}학년도 ${targetSemester}학기 입력값을 이 브라우저에 저장했습니다.`,
        });
      }
    } catch (e) {
      console.error("Save failed", e);
      setSaveError(getLocalDraftErrorMessage());
      if (options?.announce) {
        showToast({
          tone: "error",
          title: "임시 저장에 실패했습니다.",
          message: getLocalDraftErrorMessage(),
        });
      }
    }
  };

  const handleManualSave = async () => {
    setSaving(true);
    await saveScores(userScores, semester, { announce: true });
    setSaving(false);
  };

  const handleConfirmWarning = async () => {
    if (!agree || !userData || !currentUser?.uid) return;
    setWarningSaving(true);
    try {
      saveLegacyScoreWarningAcknowledgement(
        window.localStorage,
        currentUser.uid,
      );
      setWarningAcknowledgedLocal(true);
      setAgree(true);
      setSaveError(null);
      setShowWarning(false);
      showToast({
        tone: "success",
        title: "확인이 저장되었습니다.",
        message: "이 브라우저에서 성적 계산기를 계속 사용할 수 있습니다.",
      });
    } catch (e) {
      console.error("Warning agreement save failed", {
        uid: userData.uid,
        error: e,
      });
      showToast({
        tone: "error",
        title: "확인 상태를 저장하지 못했습니다.",
        message: getLocalDraftErrorMessage(),
      });
    } finally {
      setWarningSaving(false);
    }
  };

  // Processing for Display
  const getFilteredAndSortedPlans = () => {
    let filtered = plans.filter((p) => {
      const pGrade = p.targetGrade || "2";
      const pYear = p.academicYear;
      const pSem = p.semester;
      // Filter logic matches existing dashboard
      const yearMatch = !pYear || pYear === activeYear;
      const semesterMatch = !pSem || pSem === semester;
      return String(pGrade) === grade && yearMatch && semesterMatch;
    });

    // Calculate Totals
    const processed = filtered.map((p) => {
      let total = 0;
      let hasData = false;
      p.items.forEach((item, idx) => {
        const key = `${p.id}_${idx}`;
        const saved = userScores[key];
        if (saved !== undefined && saved !== "" && saved !== null) {
          hasData = true;
          const val = parseFloat(saved);
          if (!isNaN(val)) total += (val / item.maxScore) * item.ratio;
        }
      });
      return { ...p, currentScore: parseFloat(total.toFixed(1)), hasData };
    });

    if (sortMode === "name") {
      processed.sort((a, b) => a.subject.localeCompare(b.subject));
    } else if (sortMode === "importance") {
      processed.sort(
        (a, b) =>
          getSubjectPriorityIndex(a.subject) -
            getSubjectPriorityIndex(b.subject) ||
          a.subject.localeCompare(b.subject),
      );
    } else {
      // Latest
      processed.sort(
        (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
      );
    }

    return processed;
  };

  const displayPlans = getFilteredAndSortedPlans();
  const chartLabels = displayPlans.map((p) => p.subject);
  const chartData = displayPlans.map((p) => p.currentScore);
  const chartColors = displayPlans.map((p) =>
    getAchievementColor(p.currentScore, p.subject),
  );

  if (loading)
    return <PageLoading message="성적 데이터를 불러오는 중입니다." />;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fadeIn">
      {/* Warning Modal Overlay */}
      {hasHydratedUserDoc && showWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl w-full max-w-md text-center shadow-2xl animate-fadeScale">
            <div className="text-4xl mb-2">⚠️</div>
            <h3 className="text-xl font-bold text-amber-600 mb-4">
              주의사항 안내
            </h3>
            <div className="text-sm text-gray-600 mb-6 leading-relaxed">
              이 결과는 <strong>참고용 시뮬레이션</strong>이며,
              <br />
              정확한 성적은 <u>나이스(NEIS)</u> 및 <u>성적 통지표</u>를
              확인하세요.
            </div>
            <div className="text-xs text-gray-400 mb-4 bg-gray-50 p-2 rounded">
              입력한 점수는 사용자의 계정에 안전하게 저장되며 성적 계산기에서
              계속 이어집니다.
            </div>
            <div
              className="flex items-center justify-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition mb-4"
              onClick={() => setAgree(!agree)}
            >
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
              <label className="text-sm font-bold text-gray-700 cursor-pointer">
                위 내용을 확인하였으며 동의합니다.
              </label>
            </div>
            <button
              onClick={handleConfirmWarning}
              disabled={!agree || warningSaving}
              className={`w-full py-3.5 rounded-xl font-bold text-lg transition ${agree && !warningSaving ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
            >
              {warningSaving ? "저장 중..." : "확 인"}
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-600">학기</span>
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            className="p-2 border border-gray-300 rounded text-sm min-w-[100px]"
          >
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-600">학년</span>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="p-2 border border-gray-300 rounded text-sm min-w-[100px]"
          >
            <option value="1">1학년</option>
            <option value="2">2학년</option>
            <option value="3">3학년</option>
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm font-bold text-gray-600">정렬</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="p-2 border border-gray-300 rounded text-sm min-w-[120px]"
          >
            <option value="latest">등록순 (최신)</option>
            <option value="name">과목명 (가나다)</option>
            <option value="importance">중요도순 (국영수...)</option>
          </select>
        </div>
        <button
          onClick={handleManualSave}
          disabled={saving || showWarning}
          className={`px-4 py-2 rounded text-sm font-bold transition ${saving || showWarning ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          저장
        </button>
      </div>

      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Left: Cards */}
        <div>
          {displayPlans.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-400">
              해당 학기의 평가 기준 데이터가 없습니다.
            </div>
          ) : (
            displayPlans.map((plan) => (
              <ScoreCard
                key={plan.id}
                plan={plan}
                userScores={userScores}
                onScoreChange={handleScoreChange}
                totalScore={plan.currentScore}
                hasData={plan.hasData}
              />
            ))
          )}
        </div>

        {/* Right: Chart */}
        <div>
          <div className="bg-white p-5 rounded-xl border border-gray-100 sticky top-20 shadow-sm">
            <div className="text-base font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4">
              성취도 그래프
            </div>
            <div className="h-[300px]">
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">
                    그래프를 준비하는 중입니다.
                  </div>
                }
              >
                <GradeChart
                  labels={chartLabels}
                  data={chartData}
                  colors={chartColors}
                />
              </React.Suspense>
            </div>
            <div className="mt-6 flex h-8 overflow-hidden rounded-lg text-xs font-bold text-white shadow-inner">
              <div className="flex flex-1 items-center justify-center bg-red-500">
                A
              </div>
              <div className="flex flex-1 items-center justify-center bg-orange-500">
                B
              </div>
              <div className="flex flex-1 items-center justify-center bg-yellow-500">
                C
              </div>
              <div className="flex flex-1 items-center justify-center bg-green-500">
                D
              </div>
              <div className="flex flex-1 items-center justify-center bg-blue-500">
                E
              </div>
            </div>
            <div className="mt-2 text-right text-[10px] text-gray-400">
              * 음악·미술·체육은 A/B/C 3단계 평가입니다.
            </div>
          </div>
        </div>
      </div>

      {/* Save Indicator */}
      {saving && (
        <div className="fixed bottom-5 right-5 bg-gray-800 text-white px-5 py-2.5 rounded-full text-xs flex items-center gap-2 shadow-lg z-50 animate-fadeIn">
          <i className="fas fa-sync fa-spin"></i> 저장 중...
        </div>
      )}
      {!saving && lastSavedAt && !saveError && (
        <div className="fixed bottom-5 right-5 bg-emerald-700 text-white px-5 py-2.5 rounded-full text-xs flex items-center gap-2 shadow-lg z-50 animate-fadeIn">
          <i className="fas fa-check"></i> 저장 완료
        </div>
      )}
    </div>
  );
};

export default ScoreDashboard;
