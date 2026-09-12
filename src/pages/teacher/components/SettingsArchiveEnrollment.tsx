import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { ADMIN_EMAIL } from "../../../lib/permissions";
import {
  getArchiveEnrollmentState,
  type ArchiveEnrollmentState,
} from "../../../lib/archiveEnrollment";
import {
  loadSemesterCoreSnapshot,
  type SemesterManifest,
} from "../../../lib/semesterCore";
import {
  editableEnrollmentSemester,
  enrollmentClassName,
  enrollmentName,
  enrollmentStatusLabel,
} from "../../../lib/enrollmentRosterForm";
import ResponsiveDataContainer from "../../../components/common/ResponsiveDataContainer";
import { PageDataLoading } from "../../../components/common/LoadingState";
import StudentRegistrationApprovalPanel from "./StudentRegistrationApprovalPanel";
import EnrollmentRosterImport from "./EnrollmentRosterImport";
import { EnrollmentMove, EnrollmentArchive } from "./EnrollmentOperations";

const field =
  "mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 disabled:bg-gray-100";
const button =
  "rounded-lg border border-gray-200 bg-white px-4 py-3 font-bold text-gray-800 disabled:opacity-50";
const modes = {
  roster: "학급·학생 명부",
  approval: "새 학생 등록 승인",
  import: "이전 명부 가져오기",
  move: "학생 학급 이동",
  archive: "기록 보관",
} as const;
type Mode = keyof typeof modes;
const semesterLabel = (status: string) =>
  status === "ACTIVE" ? "운영 중" : enrollmentStatusLabel(status);

const SettingsArchiveEnrollment: React.FC = () => {
  const { currentUser, config } = useAuth();
  const [manifests, setManifests] = useState<SemesterManifest[]>([]);
  const [semesterId, setSemesterId] = useState("");
  const [state, setState] = useState<ArchiveEnrollmentState | null>(null);
  const [mode, setMode] = useState<Mode>("roster");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const epoch = useRef(0);
  const isAdmin = currentUser?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const manifest = manifests.find((row) => row.semesterId === semesterId);
  const currentId =
    config?.year && config?.semester ? `${config.year}-${config.semester}` : "";
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoading(true);
    setError("");
    void loadSemesterCoreSnapshot()
      .then((snapshot) => {
        if (!active) return;
        setManifests(snapshot.manifests);
        setSemesterId(
          (previous) =>
            previous ||
            snapshot.activePointer?.semesterId ||
            snapshot.manifests[0]?.semesterId ||
            "",
        );
      })
      .catch(() => {
        if (active)
          setError(
            "학기 목록을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, reload]);
  useEffect(() => {
    const id = ++epoch.current;
    setState(null);
    setFilter("");
    setSearch("");
    if (!semesterId || !isAdmin) return;
    setLoading(true);
    setError("");
    void getArchiveEnrollmentState({
      source: "EXPLICIT",
      semesterId,
      callSite: "SettingsArchiveEnrollment.selectedSemester",
    })
      .then((next) => {
        if (id !== epoch.current) return;
        if (next.semesterId !== semesterId || next.legacy)
          throw new Error("학기 범위를 확인하지 못했습니다.");
        setState(next);
      })
      .catch(() => {
        if (id === epoch.current)
          setError(
            "학급과 학생 명부를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.",
          );
      })
      .finally(() => {
        if (id === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current += 1;
    };
  }, [semesterId, isAdmin, reload]);
  const saved = useCallback(() => {
    setNotice(
      "변경 사항을 반영했습니다. 최신 명부와 학기 상태를 확인해 주세요.",
    );
    setReload((value) => value + 1);
  }, []);
  const rows = useMemo(
    () =>
      (state?.enrollments || [])
        .filter(
          (row) =>
            (!filter || row.classId === filter) &&
            (!search.trim() ||
              `${enrollmentName(row)} ${enrollmentClassName(row)} ${row.studentNumber}`.includes(
                search.trim(),
              )),
        )
        .sort(
          (left, right) =>
            enrollmentClassName(left).localeCompare(
              enrollmentClassName(right),
              "ko",
              { numeric: true },
            ) || Number(left.studentNumber) - Number(right.studentNumber),
        ),
    [state, filter, search],
  );
  if (!isAdmin)
    return <p role="alert">학급과 학적 관리는 관리자만 이용할 수 있습니다.</p>;
  return (
    <section
      className="space-y-6 min-w-0"
      aria-labelledby="archive-enrollment-heading"
    >
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2
          id="archive-enrollment-heading"
          className="text-xl font-extrabold text-gray-800"
        >
          학급·학적·아카이브
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          학기별 명부를 확인하고 학생 등록·학급 이동·기록 보관을 처리합니다.
        </p>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-blue-50 p-4 text-blue-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">
            관리할 학기
            <select
              className={field}
              value={semesterId}
              disabled={busy}
              onChange={(event) => {
                setNotice("");
                setSemesterId(event.target.value);
              }}
            >
              <option value="">학기 선택</option>
              {manifests.map((row) => (
                <option key={row.semesterId} value={row.semesterId}>
                  {row.displayName} · {semesterLabel(row.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            할 일
            <select
              className={field}
              value={mode}
              disabled={busy}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              {Object.entries(modes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className={button}
          disabled={busy || loading}
          onClick={() => setReload((value) => value + 1)}
        >
          최신 상태 다시 불러오기
        </button>
        {loading && <PageDataLoading />}
        {!loading && manifest && state && (
          <>
            <p className="text-sm text-gray-600">
              {manifest.displayName} · {semesterLabel(manifest.status)} · 학급{" "}
              {state.classes.length}개 · 재학{" "}
              {
                state.enrollments.filter(
                  (row) => row.enrollmentStatus === "ACTIVE",
                ).length
              }
              명{state.readOnly ? " · 읽기 전용" : ""}
            </p>
            {mode === "roster" && (
              <section className="space-y-4" aria-label="학급 학생 명부">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold">
                    학급
                    <select
                      className={field}
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="">전체 학급</option>
                      {state.classes.map((row) => (
                        <option key={row.classId} value={row.classId}>
                          {row.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    학생 찾기
                    <input
                      className={field}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="이름 또는 번호"
                    />
                  </label>
                </div>
                <p className="text-sm text-gray-600">
                  조회 결과 {rows.length}명/건
                </p>
                {rows.length ? (
                  <ResponsiveDataContainer label="학급 학생 명부">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {["이름", "학급", "번호", "학적"].map((label) => (
                            <th key={label} scope="col" className="p-3">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.enrollmentId || row.studentUid}
                            className="border-b border-gray-100"
                          >
                            <td className="p-3 font-bold">
                              {enrollmentName(row)}
                            </td>
                            <td className="p-3">{enrollmentClassName(row)}</td>
                            <td className="p-3">{row.studentNumber}</td>
                            <td className="p-3">
                              {enrollmentStatusLabel(row.enrollmentStatus)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ResponsiveDataContainer>
                ) : (
                  <p className="py-4 text-gray-600">
                    조건에 맞는 학생이 없습니다. 등록 승인이나 이전 명부
                    가져오기를 이용할 수 있습니다.
                  </p>
                )}
              </section>
            )}
            {mode === "approval" &&
              (state.semesterId === currentId &&
              manifest.status === "ACTIVE" ? (
                <StudentRegistrationApprovalPanel
                  key={state.semesterId}
                  semesterId={state.semesterId}
                  onApproved={saved}
                />
              ) : (
                <p className="rounded-lg bg-gray-50 p-4">
                  새 학생 등록 승인은 현재 운영 중인 학기를 선택한 뒤 진행해
                  주세요.
                </p>
              ))}
            {mode === "import" &&
              (editableEnrollmentSemester(manifest.status) &&
              !state.readOnly ? (
                <EnrollmentRosterImport
                  key={`${semesterId}:${reload}`}
                  manifest={manifest}
                  state={state}
                  manifests={manifests}
                  onApplied={saved}
                  onBusy={setBusy}
                />
              ) : (
                <p className="rounded-lg bg-gray-50 p-4">
                  종료한 학기에는 명부를 추가할 수 없습니다. 현재 또는 준비 중인
                  학기를 선택해 주세요.
                </p>
              ))}
            {mode === "move" && (
              <EnrollmentMove
                key={`${semesterId}:${reload}`}
                manifest={manifest}
                state={state}
                onSaved={saved}
                onBusy={setBusy}
              />
            )}
            {mode === "archive" && (
              <EnrollmentArchive
                key={`${semesterId}:${reload}`}
                manifest={manifest}
                state={state}
                onSaved={saved}
                onBusy={setBusy}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
};
export default SettingsArchiveEnrollment;
