import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import SegmentedAchievementChart from "../../../components/common/SegmentedAchievementChart";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";
import {
  buildScoreRows,
  buildSubjectScoreInsights,
  getTeacherAdviceText,
  type GradingPlanLike,
  type ScoreRow,
  type SubjectScoreInsight,
} from "../../../lib/studentScores";

interface UserGoalDoc {
  myPageGoalScore?: string;
  myPageSubjectGoals?: Record<string, number>;
}

const ScoreReport: React.FC = () => {
  const { user, userData, config } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [goalScore, setGoalScore] = useState("");
  const [subjectGoals, setSubjectGoals] = useState<Record<string, number>>({});
  const [selectedSubject, setSelectedSubject] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    if (!user || !config) {
      setLoading(false);
      return;
    }
    void loadReport();
  }, [user?.uid, config?.year, config?.semester, userData?.grade]);

  const loadReport = async () => {
    if (!user || !config) return;
    setLoading(true);
    try {
      const year = config.year || "2026";
      const semester = config.semester || "1";
      const scoreDocId = `${year}_${semester}`;

      const [userSnap, scoreSnap, plansSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid)),
        getDoc(doc(db, "users", user.uid, "academic_records", scoreDocId)),
        getDocs(
          query(
            collection(db, getSemesterCollectionPath(config, "grading_plans")),
            orderBy("createdAt", "desc"),
          ),
        ),
      ]);

      const userGoalData = userSnap.exists()
        ? (userSnap.data() as UserGoalDoc)
        : {};
      setGoalScore(userGoalData.myPageGoalScore || "");
      setSubjectGoals(userGoalData.myPageSubjectGoals || {});

      const scoreMap = scoreSnap.exists() ? scoreSnap.data().scores || {} : {};
      const plans: GradingPlanLike[] = [];
      plansSnap.forEach((planDoc) => {
        plans.push({ id: planDoc.id, ...planDoc.data() } as GradingPlanLike);
      });

      setRows(
        buildScoreRows(plans, scoreMap, {
          year,
          semester,
          grade: userData?.grade || "",
          filterByGrade: true,
          sortMode: "importance",
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const insights = useMemo(
    () => buildSubjectScoreInsights(rows, subjectGoals),
    [rows, subjectGoals],
  );

  useEffect(() => {
    if (!insights.length) {
      setSelectedSubject("");
      return;
    }
    if (!selectedSubject || !insights.some((item) => item.subject === selectedSubject)) {
      setSelectedSubject(insights[0].subject);
    }
  }, [insights, selectedSubject]);

  const selectedInsight = useMemo<SubjectScoreInsight | null>(
    () => insights.find((item) => item.subject === selectedSubject) || null,
    [insights, selectedSubject],
  );

  const scoreAverage =
    insights.length > 0
      ? Math.round(
          insights.reduce((sum, item) => sum + item.current, 0) / insights.length,
        )
      : 0;
  const targetMetCount = insights.filter((item) => item.gap <= 0).length;
  const needsCareCount = insights.filter((item) => item.gap > 0).length;
  const topNeedsCareSubject =
    insights
      .filter((item) => item.gap > 0)
      .sort((a, b) => b.gap - a.gap)[0] || selectedInsight;

  const saveGoal = async () => {
    if (!user) return;
    setSavingGoal(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          myPageGoalScore: goalScore.trim(),
          myPageSubjectGoals: subjectGoals,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } finally {
      setSavingGoal(false);
    }
  };

  if (loading) return <PageLoading message="성적 리포트를 불러오는 중입니다." />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-7 flex flex-col gap-3 border-b-2 border-slate-800 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            나의 성적 리포트
          </h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            저장된 성적 입력값을 기준으로 목표와 보완 과목을 확인합니다.
          </p>
        </div>
        <Link
          to="/student/score"
          className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
        >
          성적 입력으로 이동
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {[
          { label: "전체 평균", value: `${scoreAverage}점`, icon: "fa-arrow-trend-up" },
          { label: "목표 달성 과목", value: `${targetMetCount}개`, icon: "fa-bullseye" },
          { label: "보완 필요 과목", value: `${needsCareCount}개`, icon: "fa-triangle-exclamation" },
        ].map((item) => (
          <section
            key={item.label}
            className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]"
          >
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-50 text-2xl text-blue-600">
              <i className={`fas ${item.icon}`}></i>
            </span>
            <div>
              <div className="text-sm font-extrabold text-slate-600">{item.label}</div>
              <div className="mt-2 text-4xl font-black text-blue-600">{item.value}</div>
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <h2 className="text-xl font-black text-slate-900">성취도 그래프</h2>
          <div className="mt-6">
            <SegmentedAchievementChart rows={rows} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <h2 className="text-xl font-black text-slate-900">선택 과목 분석</h2>
          {selectedInsight ? (
            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap gap-2">
                {insights.map((item) => (
                  <button
                    key={item.subject}
                    type="button"
                    onClick={() => setSelectedSubject(item.subject)}
                    className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                      selectedSubject === item.subject
                        ? "bg-blue-600 text-white"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {item.subject}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <div className="text-sm font-bold text-slate-500">현재 점수</div>
                  <div className="mt-2 text-4xl font-black text-blue-600">
                    {selectedInsight.current}점
                  </div>
                </div>
                <div className="border-l border-slate-200 pl-5">
                  <div className="text-sm font-bold text-slate-500">목표 점수</div>
                  <div className="mt-2 text-4xl font-black text-violet-600">
                    {selectedInsight.target}점
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
                <i className="fas fa-lightbulb mr-2 text-blue-600"></i>
                {getTeacherAdviceText(selectedInsight)}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-bold text-slate-700">과목 목표</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={subjectGoals[selectedInsight.subject] ?? 85}
                  onChange={(event) =>
                    setSubjectGoals((prev) => ({
                      ...prev,
                      [selectedInsight.subject]: Number(event.target.value || 0),
                    }))
                  }
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                />
                <button
                  type="button"
                  onClick={() => void saveGoal()}
                  disabled={savingGoal}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                >
                  {savingGoal ? "저장 중" : "저장"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
              성적 입력 화면에서 점수를 입력하면 분석이 표시됩니다.
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
        <h2 className="text-xl font-black text-slate-900">다음 목표</h2>
        <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-extrabold leading-7 text-slate-700">
              {topNeedsCareSubject
                ? `${topNeedsCareSubject.subject} 목표 점수 ${topNeedsCareSubject.target}점 달성하기`
                : "현재 목표를 유지하기"}
            </div>
            <input
              value={goalScore}
              onChange={(event) => setGoalScore(event.target.value)}
              placeholder="예: 이번 학기 평균 85점 이상"
              className="mt-3 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm md:w-80"
            />
          </div>
          <button
            type="button"
            onClick={() => void saveGoal()}
            disabled={savingGoal}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
          >
            {savingGoal ? "저장 중" : "목표 저장"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default ScoreReport;
