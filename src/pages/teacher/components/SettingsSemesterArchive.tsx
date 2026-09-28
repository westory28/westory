import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  type ArchiveScope as SemesterScope,
  archiveSemesterLabel as semesterLabel,
  buildSemesterArchiveUrl,
  getPreviousArchiveSemesters,
} from "../../../lib/semesterArchive";

const controlClass =
  "w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-3 sm:px-3 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60";
const semesterKey = (scope: SemesterScope) => `${scope.year}-${scope.semester}`;

const SettingsSemesterArchive: React.FC = () => {
  const { currentUser, config } = useAuth();
  const [catalog, setCatalog] = useState<{
    owner: string;
    active: SemesterScope;
    previous: SemesterScope[];
  } | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [opened, setOpened] = useState(false);
  const owner = currentUser?.uid || "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setCatalog(null);
    if (!owner) {
      setLoading(false);
      setError("로그인 후 이전 학기를 조회해 주세요.");
      return;
    }
    void getDoc(doc(db, "site_settings", "config"))
      .then((snapshot) => {
        if (cancelled) return;
        const data = snapshot.data();
        const { active, previous } = getPreviousArchiveSemesters(data);
        setCatalog({ owner, active, previous });
        setSelectedKey((current) =>
          previous.some((item) => semesterKey(item) === current)
            ? current
            : previous[0]
              ? semesterKey(previous[0])
              : "",
        );
      })
      .catch((caught) => {
        if (cancelled) return;
        console.error("Failed to load archive semester registry", caught);
        setError("이전 학기 목록을 불러오지 못했습니다. 다시 불러와 주세요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, config?.year, config?.semester, reload]);

  const visibleCatalog = catalog?.owner === owner ? catalog : null;
  const selected = visibleCatalog?.previous.find(
    (item) => semesterKey(item) === selectedKey,
  );

  return (
    <div className="w-full min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-6 border-b border-gray-100 pb-4">
        <h3 className="text-lg font-bold text-gray-900">이전 학기 조회</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          연도와 학기를 선택하면 해당 학기의 위스토리가 새 창으로 열립니다.
        </p>
      </div>
      {loading && (
        <InlineLoading message="이전 학기 목록을 불러오는 중입니다." />
      )}
      {error && (
        <div role="alert" className="space-y-3">
          <p className="text-sm leading-6 text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className={secondaryButtonClass}
          >
            목록 다시 불러오기
          </button>
        </div>
      )}
      {!loading && !error && visibleCatalog && (
        <div className="space-y-6">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-blue-900">보기 전용</span>
              <span className="text-xs text-blue-900">
                현재 운영: {semesterLabel(visibleCatalog.active)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              새 창은 보기 전용입니다. 현재 운영 학기와 저장된 데이터는 바뀌지
              않습니다.
            </p>
          </div>
          {visibleCatalog.previous.length === 0 ? (
            <p className="py-6 text-sm leading-6 text-gray-500">
              현재 운영 학기보다 이전으로 등록된 학기가 없습니다.
            </p>
          ) : (
            <>
              <fieldset className="space-y-4">
                <legend className="text-sm font-bold text-gray-700">
                  조회할 이전 학기
                </legend>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:gap-4">
                  <div>
                    <label
                      htmlFor="archive-year"
                      className="mb-2 block text-sm font-bold text-gray-700"
                    >
                      학년도
                    </label>
                    <select
                      id="archive-year"
                      value={selected?.year || ""}
                      className={controlClass}
                      onChange={(event) => {
                        const next = visibleCatalog.previous.find(
                          (item) => item.year === event.target.value,
                        );
                        if (next) setSelectedKey(semesterKey(next));
                      }}
                    >
                      {[
                        ...new Set(
                          visibleCatalog.previous.map((item) => item.year),
                        ),
                      ].map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="archive-semester"
                      className="mb-2 block text-sm font-bold text-gray-700"
                    >
                      학기
                    </label>
                    <select
                      id="archive-semester"
                      value={selectedKey}
                      className={controlClass}
                      onChange={(event) => setSelectedKey(event.target.value)}
                    >
                      {visibleCatalog.previous
                        .filter((item) => item.year === selected?.year)
                        .map((item) => (
                          <option
                            key={semesterKey(item)}
                            value={semesterKey(item)}
                          >
                            {item.semester}학기
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={!selected}
                    aria-label="조회하기 (새 창)"
                    className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-3 sm:px-6 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      if (!selected) return;
                      window.open(
                        buildSemesterArchiveUrl(selected, window.location.href),
                        "_blank",
                        "popup,width=1440,height=960,noopener,noreferrer",
                      );
                      setOpened(true);
                    }}
                  >
                    조회하기{" "}
                    <i
                      className="fas fa-arrow-up-right-from-square ml-2 hidden sm:inline"
                      aria-hidden="true"
                    />
                  </button>
                </div>
                {opened && (
                  <p role="status" className="text-sm leading-6 text-gray-500">
                    창이 열리지 않으면 브라우저의 팝업 차단을 해제한 뒤 다시
                    눌러 주세요.
                  </p>
                )}
              </fieldset>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SettingsSemesterArchive;
