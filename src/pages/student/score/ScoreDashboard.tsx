import React, { useEffect, useState, useRef } from "react";
import { db } from "../../../lib/firebase";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
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
import { buildScoreRows } from "../../../lib/studentScores";

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

const getFirestoreErrorCode = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";

const getWarningAgreementErrorMessage = (error: unknown) => {
  const code = getFirestoreErrorCode(error);
  if (code === "permission-denied") {
    return "학생 정보 저장 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code === "unavailable") {
    return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return "동의 저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
};

const ScoreDashboard: React.FC = () => {
  const { userData, currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const { year: activeYear, semester: activeSemester } =
    getYearSemester(config);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<GradingPlan[]>([]);
  const [userScores, setUserScores] = useState<{ [key: string]: string }>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [agree, setAgree] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [warningSaving, setWarningSaving] = useState(false);
  const [warningNeedsRetry, setWarningNeedsRetry] = useState(false);
  const [warningAcknowledgedLocal, setWarningAcknowledgedLocal] =
    useState(false);
  const hasHydratedUserDoc = userData?.uid === currentUser?.uid;

  // Filters
  const [semester, setSemester] = useState(activeSemester);
  const [grade, setGrade] = useState(userData?.grade || "1");
  const [sortMode, setSortMode] = useState("importance");

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const didInitDefaultsRef = useRef(false);

  const getDraftKey = (targetSemester: string) => {
    const uid = currentUser?.uid || userData?.uid || "anonymous";
    return `scoreDraft:${uid}:${activeYear}:${targetSemester}`;
  };

  const persistDraftScores = (
    targetSemester: string,
    scoresToDraft: { [key: string]: string },
  ) => {
    try {
      localStorage.setItem(
        getDraftKey(targetSemester),
        JSON.stringify({
          scores: scoresToDraft,
          savedAt: Date.now(),
        }),
      );
    } catch (error) {
      console.error("Failed to persist temporary scores:", error);
    }
  };

  const loadDraftScores = (
    targetSemester: string,
  ): { [key: string]: string } => {
    try {
      const raw = localStorage.getItem(getDraftKey(targetSemester));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as { scores?: { [key: string]: string } };
      return parsed?.scores && typeof parsed.scores === "object"
        ? parsed.scores
        : {};
    } catch (error) {
      console.error("Failed to load temporary scores:", error);
      return {};
    }
  };

  const clearDraftScores = (targetSemester: string) => {
    try {
      localStorage.removeItem(getDraftKey(targetSemester));
    } catch (error) {
      console.error("Failed to clear temporary scores:", error);
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
    setWarningAcknowledgedLocal(false);
    setWarningNeedsRetry(false);
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    setPlans([]);
    setUserScores({});
    const unsubscribe = onSnapshot(
      query(
        collection(
          db,
          getSemesterCollectionPath(
            { year: activeYear, semester },
            "grading_plans",
          ),
        ),
        orderBy("createdAt", "desc"),
      ),
      (snapshot) => {
        if (active)
          setPlans(
            snapshot.docs.map(
              (item) => ({ id: item.id, ...item.data() }) as GradingPlan,
            ),
          );
      },
      (error) => {
        console.error("Failed to subscribe to grading plans:", error);
        if (active)
          setLoadError(
            "평가 기준을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.",
          );
      },
    );
    getDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "academic_records",
        activeYear + "_" + semester,
      ),
    )
      .then((snapshot) => {
        if (active)
          setUserScores({
            ...(snapshot.exists() ? snapshot.data().scores || {} : {}),
            ...loadDraftScores(semester),
          });
      })
      .catch((error) => {
        console.error("Error loading score data:", error);
        if (active) {
          setUserScores(loadDraftScores(semester));
          setLoadError(
            "저장된 점수를 불러오지 못했습니다. 연결 상태를 확인한 뒤 새로고침해 주세요.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser?.uid, activeYear, semester]);

  useEffect(() => {
    if (!currentUser?.uid || !hasHydratedUserDoc) {
      setShowWarning(false);
      setAgree(false);
      return;
    }

    if (warningSaving || warningNeedsRetry) return;
    const warningAcknowledged =
      warningAcknowledgedLocal || userData?.scoreWarningAcknowledged === true;
    setShowWarning(!warningAcknowledged);
    setAgree(warningAcknowledged);
  }, [
    currentUser?.uid,
    hasHydratedUserDoc,
    userData?.scoreWarningAcknowledged,
    warningAcknowledgedLocal,
    warningSaving,
    warningNeedsRetry,
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
      if (loading) return;
      persistDraftScores(semester, userScores);
    };

    const handleVisibilityChange = () => {
      if (!loading && document.visibilityState === "hidden") {
        persistDraftScores(semester, userScores);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeYear,
    currentUser?.uid,
    semester,
    userData?.uid,
    userScores,
    loading,
  ]);

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
    persistDraftScores(semester, newScores);

    // Debounce Save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    const semesterForSave = semester;
    saveTimeoutRef.current = setTimeout(async () => {
      await saveScores(newScores, semesterForSave);
      setSaving(false);
    }, 1000);
  };

  const sanitizeScores = (scoresToSave: { [key: string]: string }) => {
    const sanitized: { [key: string]: string } = {};
    Object.entries(scoresToSave || {}).forEach(([key, rawValue]) => {
      if (!key || key.length > 120 || !/^.+_\d+$/.test(key)) return;
      if (rawValue === "") {
        sanitized[key] = "";
        return;
      }
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1000) return;
      sanitized[key] = String(numeric);
    });
    return sanitized;
  };

  const saveScores = async (
    scoresToSave: { [key: string]: string },
    targetSemester: string = semester,
    options?: { announce?: boolean },
  ) => {
    if (!currentUser?.uid || loadError) return;
    const scoreDocId = `${activeYear}_${targetSemester}`;
    const sanitizedScores = sanitizeScores(scoresToSave);
    try {
      await setDoc(
        doc(db, "users", currentUser.uid, "academic_records", scoreDocId),
        {
          scores: sanitizedScores,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setLastSavedAt(Date.now());
      setSaveError(null);
      // An older save must not erase newer unsaved input.
      const currentDraft = loadDraftScores(targetSemester);
      if (
        JSON.stringify(sanitizeScores(currentDraft)) ===
        JSON.stringify(sanitizedScores)
      )
        clearDraftScores(targetSemester);
      if (options?.announce) {
        showToast({
          tone: "success",
          title: "성적 계산기가 저장되었습니다.",
          message: `${activeYear}학년도 ${targetSemester}학기 입력값이 반영되었습니다.`,
        });
      }
    } catch (e) {
      console.error("Save failed", e);
      setSaveError("저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      if (options?.announce) {
        showToast({
          tone: "error",
          title: "저장에 실패했습니다.",
          message: "잠시 후 다시 시도해 주세요.",
        });
      }
    }
  };

  const handleManualSave = async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    await saveScores(userScores, semester, { announce: true });
    setSaving(false);
  };

  const handleConfirmWarning = async () => {
    if (
      !agree ||
      !userData ||
      warningSaving ||
      !currentUser?.uid ||
      currentUser.uid !== userData.uid
    )
      return;
    setWarningNeedsRetry(true);
    setWarningSaving(true);
    let userDocExists: boolean | null = null;
    try {
      const userRef = doc(db, "users", userData.uid);
      const userSnap = await getDocFromServer(userRef);
      userDocExists = userSnap.exists();
      const warningPayload: Record<string, unknown> = {
        scoreWarningAcknowledged: true,
        scoreWarningAcknowledgedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (!userDocExists) {
        const email = (currentUser?.email || userData.email || "").trim();
        if (!email) {
          throw new Error(
            "Missing authenticated email for score warning consent bootstrap.",
          );
        }

        warningPayload.uid = userData.uid;
        warningPayload.email = email;
        warningPayload.photoURL =
          currentUser?.photoURL || userData.photoURL || "";
        warningPayload.role = "student";
        warningPayload.staffPermissions = [];
        warningPayload.teacherPortalEnabled = false;
        warningPayload.createdAt = serverTimestamp();
        warningPayload.lastLogin = serverTimestamp();

        if (typeof userData.name === "string" && userData.name.trim()) {
          warningPayload.name = userData.name.trim();
        }
        if (typeof userData.grade === "string" && userData.grade.trim()) {
          warningPayload.grade = userData.grade.trim();
        }
        if (typeof userData.class === "string" && userData.class.trim()) {
          warningPayload.class = userData.class.trim();
        }
        if (typeof userData.number === "string" && userData.number.trim()) {
          warningPayload.number = userData.number.trim();
        }
        if (userData.customNameConfirmed === true) {
          warningPayload.customNameConfirmed = true;
        }
        if (userData.privacyAgreed === true) {
          warningPayload.privacyAgreed = true;
          if (userData.privacyAgreedAt) {
            warningPayload.privacyAgreedAt = userData.privacyAgreedAt;
          }
        }
        if (
          Array.isArray(userData.consentAgreedItems) &&
          userData.consentAgreedItems.length > 0
        ) {
          warningPayload.consentAgreedItems =
            userData.consentAgreedItems.filter(
              (item): item is string => typeof item === "string",
            );
        }
      }

      await setDoc(userRef, warningPayload, { merge: true });
      const savedWarning = await getDocFromServer(userRef);
      if (
        savedWarning.data()?.scoreWarningAcknowledged !== true ||
        !savedWarning.data()?.scoreWarningAcknowledgedAt
      )
        throw new Error(
          "Score warning consent was not confirmed by the server.",
        );
      setWarningAcknowledgedLocal(true);
      setWarningNeedsRetry(false);
      setAgree(true);
      setSaveError(null);
      setShowWarning(false);
      showToast({
        tone: "success",
        title: "동의가 저장되었습니다.",
        message: "이제 성적 계산기를 계속 사용할 수 있습니다.",
      });
    } catch (e) {
      console.error("Warning agreement save failed", {
        uid: userData.uid,
        userDocPath: `users/${userData.uid}`,
        hasUserDoc: userDocExists,
        code: getFirestoreErrorCode(e),
        error: e,
      });
      showToast({
        tone: "error",
        title: "동의 저장에 실패했습니다.",
        message: getWarningAgreementErrorMessage(e),
      });
    } finally {
      setWarningSaving(false);
    }
  };

  const chartRows = buildScoreRows(plans, userScores, {
    year: activeYear,
    semester,
    grade: String(grade),
    sortMode: sortMode as "importance" | "name" | "latest",
  });
  const displayPlans = chartRows.map((row) => ({
    ...plans.find((plan) => plan.id === row.id)!,
    currentScore: row.total,
    hasData: row.hasData,
  }));

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
            <label className="flex items-center justify-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition mb-4">
              <input
                type="checkbox"
                disabled={warningSaving}
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm font-bold text-gray-700">
                위 내용을 확인하였으며 동의합니다.
              </span>
            </label>
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
            <option value="importance">중요도순 (국어·수학·사회…)</option>
          </select>
        </div>
        <button
          onClick={handleManualSave}
          disabled={saving || showWarning || !!loadError}
          className={`px-4 py-2 rounded text-sm font-bold transition ${saving || showWarning || loadError ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          저장
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <React.Suspense fallback={<p>그래프를 준비하는 중입니다.</p>}>
        <GradeChart rows={chartRows} />
      </React.Suspense>
      {/* Score inputs */}
      <div>
        {/* Left: Cards */}
        <div>
          {displayPlans.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-100 text-gray-400">
              해당 학기의 평가 기준 데이터가 없습니다.
            </div>
          ) : (
            displayPlans.map((plan) => (
              <ScoreCard
                disabled={showWarning || !!loadError}
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
