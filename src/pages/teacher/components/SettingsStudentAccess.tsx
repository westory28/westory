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
              setError(
                "접속 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 불러와 주세요.",
              );
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
      setNotice(closed ? "학생 접속을 닫았습니다." : "학생 접속을 열었습니다.");
    } catch {
      // A lost response may follow a successful write. Require a server read;
      // never automatically replay an operation that could reopen access.
      setConfig(null);
      setError(
        "변경 결과를 확인하지 못했습니다. 자동으로 재시도하지 않습니다. 다시 불러와 현재 상태를 확인해 주세요.",
      );
    } finally {
      setIntent(null);
      setBusy(false);
      inFlight.current = false;
    }
  };
  const button =
    "min-h-[44px] rounded-lg px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
  if (!admin)
    return (
      <div role="alert" className="rounded-xl border bg-white p-6">
        관리자만 학생 접속을 관리할 수 있습니다.
      </div>
    );

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm"
      aria-labelledby="student-access-heading"
      aria-busy={loading || busy}
    >
      <h2
        id="student-access-heading"
        className="text-xl font-extrabold text-gray-800"
      >
        학생 접속 관리
      </h2>
      <p className="mt-2 text-gray-600">
        학생 접속을 닫으면 다시 열기 전까지 제한이 유지됩니다. 교사와 관리자는
        계속 이용할 수 있습니다.
      </p>
      {loading && (
        <p role="status" className="mt-6">
          현재 접속 상태를 확인하고 있습니다.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 rounded-lg bg-blue-50 p-4 text-blue-800"
        >
          {notice}
        </p>
      )}
      {config && !loading && (
        <>
          <div className="mt-6 rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">서버에서 확인한 현재 상태</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {config.enabled ? "학생 접속 닫힘" : "학생 접속 열림"}
            </p>
            <p className="mt-2 text-sm text-gray-600">
              {config.enabled
                ? "학생은 접속 제한 안내를 보게 됩니다. 자동으로 열리지 않습니다."
                : "승인된 학생이 사이트를 이용할 수 있습니다."}
            </p>
            {config.enabled && config.bypassUids.length > 0 && (
              <p className="mt-2 text-amber-800">
                예외 계정이 {config.bypassUids.length}개 있습니다. ‘모든 학생
                접속 닫기’를 누르면 예외도 해제됩니다.
              </p>
            )}
            <p className="mt-3 text-sm text-gray-500">
              설정 버전 {config.revision}
            </p>
          </div>
          <div className="mt-5">
            <h3 className="font-bold text-gray-800">접속 제한 안내</h3>
            <p className="mt-2 font-medium">{config.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-600">
              {config.message}
            </p>
          </div>
          {intent === null ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                className={`${button} bg-blue-600 text-white hover:bg-blue-700`}
                onClick={() => {
                  setNotice("");
                  setIntent(!config.enabled);
                }}
              >
                {config.enabled ? "학생 접속 열기" : "학생 접속 닫기"}
              </button>
              {config.enabled && config.bypassUids.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className={`${button} border border-gray-300`}
                  onClick={() => setIntent(true)}
                >
                  모든 학생 접속 닫기
                </button>
              )}
            </div>
          ) : (
            <div
              className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4"
              role="group"
              aria-labelledby="student-access-confirm"
            >
              <p id="student-access-confirm" className="font-bold">
                {intent
                  ? "모든 학생 접속을 닫으시겠습니까?"
                  : "학생 접속을 지금 여시겠습니까?"}
              </p>
              <p className="mt-2 text-sm text-gray-700">
                {intent
                  ? "이용 중인 학생도 서비스 이용이 제한됩니다. 기록은 삭제되지 않습니다."
                  : "저장하는 즉시 승인된 학생이 사이트에 접속할 수 있습니다."}{" "}
                필요하면 관리자 본인 확인을 진행합니다.
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
                    ? "변경 중…"
                    : intent
                      ? "확인하고 닫기"
                      : "확인하고 열기"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className={`${button} mt-6 border border-gray-300 text-gray-700 hover:bg-gray-50`}
        disabled={loading || busy}
        onClick={() => {
          setNotice("");
          setReload((value) => value + 1);
        }}
      >
        현재 상태 다시 불러오기
      </button>
    </section>
  );
};

export default SettingsStudentAccess;
