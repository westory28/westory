import React, { useEffect, useState } from "react";
import { auth } from "../../../lib/firebase";
import { ADMIN_EMAIL } from "../../../lib/permissions";
import { useAuth } from "../../../contexts/AuthContext";
import {
  planCurrentAssessmentRelease,
  prepareCurrentAssessmentRelease,
  type AssessmentReleasePlan,
} from "../../../lib/assessmentRelease";
import {
  readStudentAccessConfig,
  setStudentAccessAllowed,
  type StudentAccessConfig,
} from "../../../lib/studentAccessControl";

const SettingsStudentAccess: React.FC = () => {
  const { config: schoolConfig } = useAuth();
  const [plan, setPlan] = useState<AssessmentReleasePlan | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [planError, setPlanError] = useState("");
  const [config, setConfig] = useState<StudentAccessConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL;
  useEffect(() => {
    setPlan(null);
    setPlanError("");
  }, [schoolConfig?.year, schoolConfig?.semester, isAdmin]);
  const review = async () => {
    setPreparing(true);
    setPlanError("");
    try {
      setPlan(await planCurrentAssessmentRelease(schoolConfig));
    } catch (failure) {
      setPlan(null);
      setPlanError(
        failure instanceof Error
          ? failure.message
          : "평가 공개 상태를 확인하지 못했습니다.",
      );
    } finally {
      setPreparing(false);
    }
  };
  const prepare = async () => {
    if (!plan || preparing) return;
    setPreparing(true);
    setPlanError("");
    try {
      await prepareCurrentAssessmentRelease(plan);
      setPlan(await planCurrentAssessmentRelease(schoolConfig));
    } catch (failure) {
      setPlan(null);
      setPlanError(
        failure instanceof Error
          ? failure.message
          : "평가 준비를 완료하지 못했습니다.",
      );
    } finally {
      setPreparing(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      setConfig(await readStudentAccessConfig());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "학생 접속 설정을 확인하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!isAdmin) return;
    let current = true;
    void readStudentAccessConfig()
      .then((value) => {
        if (current) setConfig(value);
      })
      .catch((failure) => {
        if (current)
          setError(
            failure instanceof Error
              ? failure.message
              : "학생 접속 설정을 확인하지 못했습니다.",
          );
      });
    return () => {
      current = false;
    };
  }, [isAdmin]);
  const update = async () => {
    if (!config || busy) return;
    setBusy(true);
    setError("");
    try {
      let expectedSemesterId: string | undefined;
      if (config.enabled) {
        const current = await planCurrentAssessmentRelease(schoolConfig);
        setPlan(current);
        if (
          !plan ||
          current.semesterId !== plan.semesterId ||
          current.prepareCount ||
          current.blockedCount
        ) {
          throw new Error(
            "평가 공개 상태가 바뀌었습니다. 준비 목록을 다시 확인해 주세요.",
          );
        }
        expectedSemesterId = current.semesterId;
      }
      setConfig(
        await setStudentAccessAllowed(
          config.enabled,
          config.revision,
          expectedSemesterId,
        ),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "학생 접속 설정을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!isAdmin) return null;
  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      aria-label="학생 접속 관리"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">학생 접속</h3>
          <p className="mt-1 text-sm text-gray-600" role="status">
            {config
              ? config.enabled
                ? "현재 학생 접속 제한 중"
                : "현재 학생 접속 허용 중"
              : "접속 상태 확인 중"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={busy}
          >
            상태 새로고침
          </button>
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void update()}
            disabled={
              busy ||
              !config ||
              (config.enabled &&
                (!plan ||
                  plan.blockedCount > 0 ||
                  plan.prepareCount > 0 ||
                  preparing))
            }
          >
            {busy
              ? "처리 중"
              : config?.enabled
                ? "학생 접속 열기"
                : "학생 접속 제한"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-5 border-t border-gray-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-semibold text-gray-900">현재 학기 평가 공개</h4>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={preparing || busy}
              onClick={() => void review()}
            >
              {preparing ? "확인 중" : "공개 상태 점검"}
            </button>
            {plan && plan.prepareCount > 0 && (
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={preparing || busy || plan.blockedCount > 0}
                onClick={() => void prepare()}
              >
                공개 평가 준비 ({plan.prepareCount})
              </button>
            )}
          </div>
        </div>
        {plan && (
          <p className="mt-2 text-sm text-gray-600" role="status">
            전체 {plan.items.length}개 · 준비 완료{" "}
            {plan.items.length - plan.prepareCount - plan.blockedCount}개 · 준비
            필요 {plan.prepareCount}개 · 확인 필요 {plan.blockedCount}개
          </p>
        )}
        {plan && plan.items.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {plan.items.map((item) => (
              <li
                key={item.definitionId}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{item.title}</span>
                <span
                  className={
                    item.status === "BLOCKED" ? "text-red-600" : "text-gray-600"
                  }
                >
                  {item.reason ||
                    (item.status === "READY"
                      ? "준비 완료"
                      : `${item.itemCount}문항 · 준비 필요`)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {planError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {planError}
          </p>
        )}
      </div>
    </section>
  );
};
export default SettingsStudentAccess;
