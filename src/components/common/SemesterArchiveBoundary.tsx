import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { doc, getDocFromServer } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { isAdminUser } from "../../lib/permissions";
import {
  archiveScope,
  archiveSemesterLabel,
  getPreviousArchiveSemesters,
  isSemesterArchive,
} from "../../lib/semesterArchive";
import { PageLoading } from "./LoadingState";

export const SemesterArchiveBoundary: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { currentUser, userData, loading, configReady } = useAuth();
  const location = useLocation();
  const [verifiedOwner, setVerifiedOwner] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const allowed = isAdminUser(userData, currentUser?.email);
  useEffect(() => {
    if (
      !isSemesterArchive ||
      loading ||
      !currentUser ||
      !allowed ||
      !archiveScope
    )
      return;
    const selected = archiveScope;
    let cancelled = false;
    setVerifiedOwner("");
    setError("");
    void getDocFromServer(doc(db, "site_settings", "config"))
      .then((snapshot) => {
        const { previous } = getPreviousArchiveSemesters(snapshot.data());
        if (
          !previous.some(
            (scope) =>
              scope.year === selected.year &&
              scope.semester === selected.semester,
          )
        ) {
          throw new Error(
            "등록된 이전 학기가 아닙니다. 운영 창에서 조회할 학기를 다시 선택해 주세요.",
          );
        }
        if (!cancelled) setVerifiedOwner(currentUser.uid);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "이전 학기를 확인하지 못했습니다. 다시 시도해 주세요.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, currentUser?.uid, loading, retry]);

  if (!isSemesterArchive) return <>{children}</>;
  const message = !archiveScope
    ? "조회할 연도와 학기를 확인해 주세요. 운영 창에서 이전 학기를 다시 선택해 주세요."
    : !loading && (!currentUser || !allowed)
      ? "운영 창에서 관리자 계정으로 로그인한 뒤 이전 학기를 다시 열어 주세요."
      : error;
  if (message)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-bold text-gray-900">이전 학기 조회</h1>
        <p role="alert" className="text-sm leading-6 text-gray-700">
          {message}
        </p>
        {error && (
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="mt-4 rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"
          >
            다시 확인하기
          </button>
        )}
      </div>
    );
  if (loading || !configReady || verifiedOwner !== currentUser?.uid) {
    return <PageLoading message="이전 학기 조회 창을 준비하는 중입니다." />;
  }
  if (location.pathname.startsWith("/student"))
    return <Navigate to="/teacher/dashboard" replace />;
  return <>{children}</>;
};

export const SemesterArchiveHome = () => (
  <Navigate to="/teacher/dashboard" replace />
);

export const SemesterArchiveBanner = () => {
  useEffect(() => {
    if (!isSemesterArchive || !archiveScope) return;
    document.title = `${archiveSemesterLabel(archiveScope)} 조회 · 위스토리`;
  }, []);
  if (!isSemesterArchive || !archiveScope) return null;
  return (
    <aside
      aria-label="이전 학기 조회 상태"
      className="border-b border-blue-100 bg-blue-50 px-4 py-3 text-blue-900"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">
            {archiveSemesterLabel(archiveScope)} 위스토리 · 보기 전용
          </p>
          <p className="mt-1 text-sm leading-6">
            조회 창의 변경 사항은 저장되지 않으며, 현재 학기 데이터에 영향을
            주지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-lg border border-blue-200 bg-white px-4 py-3 text-sm font-bold hover:bg-blue-50"
        >
          조회 창 닫기
        </button>
      </div>
    </aside>
  );
};

export const isArchiveUnavailableRoute = (pathname: string) =>
  isSemesterArchive &&
  [
    "/teacher/students",
    "/teacher/settings",
    "/teacher/lesson/history-dictionary",
    "/teacher/lesson/source-archive",
    "/developer-log",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));

export const SemesterArchiveUnavailable = () => (
  <div className="mx-auto max-w-3xl p-6">
    <h1 className="mb-3 text-lg font-bold text-gray-900">
      학기별 보관 자료가 없는 메뉴입니다.
    </h1>
    <p className="text-sm leading-6 text-gray-600">
      이 메뉴는 학기 구분 없이 공통으로 운영됩니다. 이전 학기 조회에서는 현재
      자료를 표시하지 않습니다. 다른 메뉴에서 해당 학기의 자료를 확인해 주세요.
    </p>
  </div>
);
