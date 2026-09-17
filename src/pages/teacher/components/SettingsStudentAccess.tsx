import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { ADMIN_EMAIL } from "../../../lib/permissions";
import {
  changeStudentAccess,
  readStudentAccessSettings,
} from "../../../lib/studentAccessSettings";
import type { StudentMaintenanceConfig } from "../../../lib/studentMaintenance";

const SettingsStudentAccess: React.FC = () => {
  const { currentUser } = useAuth();
  const admin = currentUser?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const [config, setConfig] = useState<StudentMaintenanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [intent, setIntent] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setConfig(null);
    setIntent(null);
    setError("");
    setLoading(admin);
    if (admin) {
      readStudentAccessSettings()
        .then(
          (value) => {
            if (active) setConfig(value);
          },
          () => {
            if (active)
              setError("접속 상태를 불러오지 못했습니다. 새로고침해 주세요.");
          },
        )
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [admin, currentUser?.uid, reload]);

  const confirmChange = async () => {
    if (!admin || intent === null || !config || inFlight.current) return;
    const closed = intent;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await changeStudentAccess(closed);
      setConfig(saved);
      setNotice(
        closed ? "학생 접속을 제한했습니다." : "학생 접속을 허용했습니다.",
      );
    } catch {
      // A lost response may follow a successful write. Require a server read;
      // never automatically replay an operation that could reopen access.
      setConfig(null);
      setError(
        "변경 결과를 확인하지 못했습니다. 새로고침해 현재 상태를 확인해 주세요.",
      );
    } finally {
      setIntent(null);
      setBusy(false);
      inFlight.current = false;
    }
  };
  const button =
    "min-h-[44px] rounded-lg px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
  if (!admin) return null;

  return (
    <section
      className="border-b border-gray-100 pb-6"
      aria-labelledby="student-access-heading"
      aria-busy={loading || busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h4
            id="student-access-heading"
            className="text-sm font-bold text-gray-900"
          >
            학생 접속
          </h4>
          {loading ? (
            <span role="status" className="text-sm text-gray-500">
              확인 중...
            </span>
          ) : config ? (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-bold ${config.enabled ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
            >
              {config.enabled ? "제한 중" : "허용 중"}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config && !loading && intent === null && (
            <>
              <button
                type="button"
                disabled={busy}
                className={`${button} border border-gray-300 text-gray-700 hover:bg-gray-50`}
                onClick={() => {
                  setNotice("");
                  setIntent(!config.enabled);
                }}
              >
                {config.enabled ? "접속 허용" : "접속 제한"}
              </button>
              {config.enabled && config.bypassUids.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className={`${button} border border-gray-300 text-gray-700 hover:bg-gray-50`}
                  onClick={() => setIntent(true)}
                >
                  예외 계정도 제한 ({config.bypassUids.length})
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"
            aria-label="학생 접속 상태 새로고침"
            title="학생 접속 상태 새로고침"
            disabled={loading || busy}
            onClick={() => {
              setNotice("");
              setReload((value) => value + 1);
            }}
          >
            <i className="fas fa-rotate-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-blue-700">
          {notice}
        </p>
      )}
      {config && !loading && (
        <>
          {intent !== null && (
            <div
              className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"
              role="group"
              aria-labelledby="student-access-confirm"
            >
              <p id="student-access-confirm" className="font-bold">
                {intent
                  ? "모든 학생의 접속을 제한하시겠습니까?"
                  : "학생 접속을 허용하시겠습니까?"}
              </p>
              <p className="mt-2 text-sm text-gray-700">
                {intent
                  ? "이용 중인 학생에게도 즉시 적용됩니다. 학생 기록은 유지됩니다."
                  : "승인된 학생이 즉시 접속할 수 있습니다."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={`${button} border border-gray-300 bg-white`}
                  disabled={busy}
                  onClick={() => setIntent(null)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className={`${button} bg-blue-600 text-white hover:bg-blue-700`}
                  disabled={busy}
                  onClick={confirmChange}
                >
                  {busy
                    ? "변경 중..."
                    : intent
                      ? "접속 제한 적용"
                      : "접속 허용 적용"}
                </button>
              </div>
            </div>
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer py-2 font-bold text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
              접속 제한 안내문
            </summary>
            <div className="mt-2 rounded-lg bg-gray-50 p-4">
              <p className="font-bold text-gray-800">{config.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-gray-600">
                {config.message}
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
};

export default SettingsStudentAccess;
