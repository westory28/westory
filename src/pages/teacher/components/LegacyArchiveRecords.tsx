import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getAdminSemesterLegacyRecords,
  type AdminLegacyRecord,
  type AdminLegacyRecordType,
} from "../../../lib/adminSemesterLegacyRecords";
import {
  appendArchivePage,
  archiveDate,
} from "../../../lib/semesterArchiveView";
import ResponsiveDataContainer from "../../../components/common/ResponsiveDataContainer";

const kinds = {
  wis_wallets: "기존 위스 잔액",
  wis_transactions: "기존 위스 전체 거래",
  wis_orders: "기존 위스 주문",
  grades: "기존 성적",
  quiz_results: "퀴즈 풀이 결과",
  history_results: "역사 교실 풀이 결과",
} as const;
type VisibleKind = keyof typeof kinds;
const buttonClass =
  "px-4 py-3 rounded-lg border border-gray-200 bg-white text-gray-800 font-bold hover:bg-gray-50 disabled:opacity-60";
const fieldClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-gray-800";
const studentLabel = (row: AdminLegacyRecord) =>
  [
    row.grade ? `${row.grade}학년` : "",
    row.className ? `${row.className.replace(/반$/u, "")}반` : "",
    row.number ? `${row.number}번` : "",
    row.studentName || "이름 기록 없음",
  ]
    .filter(Boolean)
    .join(" ");
const value = (amount: number | null) =>
  amount === null ? "—" : amount.toLocaleString("ko-KR");
const recordStatus = (status: string) => {
  const labels: Record<string, string> = {
    pending: "대기",
    requested: "신청",
    approved: "승인",
    rejected: "반려",
    fulfilled: "지급 완료",
    completed: "완료",
    cancelled: "취소",
    canceled: "취소",
    submitted: "제출",
    passed: "통과",
    failed: "미통과",
  };
  return labels[status.toLowerCase()] || status;
};

function useLegacyPage(
  semesterId: string,
  recordType: AdminLegacyRecordType,
  studentUid?: string,
  enabled = true,
) {
  const [rows, setRows] = useState<AdminLegacyRecord[]>([]);
  const [cursor, setCursor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const load = useCallback(
    async (next = "") => {
      const id = ++epoch.current;
      setBusy(true);
      setError("");
      try {
        const data = await getAdminSemesterLegacyRecords({
          semesterId,
          recordType,
          ...(studentUid ? { studentUid } : {}),
          ...(next ? { cursor: next } : {}),
        });
        if (id !== epoch.current) return;
        setRows((previous) =>
          next
            ? appendArchivePage(previous, data.rows, (row) => row.id)
            : data.rows,
        );
        setCursor(data.hasMore ? data.nextCursor || "" : "");
        setLoaded(true);
      } catch {
        if (id === epoch.current)
          setError(
            "기존 보관 기록을 불러오지 못했습니다. 로그인 상태와 네트워크를 확인한 뒤 다시 시도해 주세요.",
          );
      } finally {
        if (id === epoch.current) setBusy(false);
      }
    },
    [recordType, semesterId, studentUid],
  );
  useEffect(() => {
    setRows([]);
    setCursor("");
    setLoaded(false);
    setError("");
    if (enabled) void load();
    return () => {
      epoch.current += 1;
    };
  }, [enabled, load]);
  return { rows, cursor, loaded, busy, error, load };
}

function LegacyList({
  semesterId,
  kind,
  studentUid,
}: {
  semesterId: string;
  kind: VisibleKind;
  studentUid?: string;
}) {
  const page = useLegacyPage(semesterId, kind, studentUid);
  const wis = kind.startsWith("wis_");
  return (
    <div className="space-y-4" aria-label={kinds[kind]}>
      {page.busy && <p role="status">보관 기록을 불러오는 중입니다.</p>}
      {page.error && (
        <div role="alert" className="text-red-700">
          <p>{page.error}</p>
          <button
            className={`${buttonClass} mt-3`}
            disabled={page.busy}
            onClick={() => void page.load(page.cursor)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {page.loaded && (
        <>
          <p className="text-sm text-gray-600">
            불러온 기록 {page.rows.length.toLocaleString("ko-KR")}건
            {page.cursor ? " · 다음 기록이 있습니다." : ""}
          </p>
          {page.rows.length === 0 ? (
            <p className="text-gray-600">
              선택한 범위에서 확인된 기록이 없습니다.
              {page.cursor ? " 다음 기록도 확인해 주세요." : ""}
            </p>
          ) : (
            <ResponsiveDataContainer label={kinds[kind]}>
              <table className="w-full text-sm text-left text-gray-800">
                <thead className="bg-gray-50">
                  <tr>
                    {[
                      "학생",
                      "기록",
                      wis ? "위스" : "점수",
                      "일시",
                      "상세",
                    ].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="p-3 whitespace-nowrap font-bold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100">
                      <td className="p-3 align-top">{studentLabel(row)}</td>
                      <td className="p-3 align-top">
                        {row.title || kinds[kind]}
                      </td>
                      <td className="p-3 align-top whitespace-nowrap">
                        {wis
                          ? kind === "wis_wallets"
                            ? value(row.balance)
                            : value(row.amount)
                          : `${value(row.score)} / ${value(row.maxScore)}`}
                        {kind === "wis_transactions" &&
                          row.balance !== null && (
                            <p className="text-gray-600">
                              잔액 {value(row.balance)}
                            </p>
                          )}
                      </td>
                      <td className="p-3 align-top">
                        {archiveDate(row.occurredAt)}
                      </td>
                      <td className="p-3 align-top whitespace-pre-wrap break-words">
                        {row.status && (
                          <p className="font-bold">
                            {recordStatus(row.status)}
                          </p>
                        )}
                        {row.detail || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveDataContainer>
          )}
          {page.cursor && (
            <button
              className={buttonClass}
              disabled={page.busy}
              onClick={() => void page.load(page.cursor)}
            >
              다음 기록 더 보기
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LegacyGrades({ semesterId }: { semesterId: string }) {
  const students = useLegacyPage(semesterId, "grade_students");
  const [studentUid, setStudentUid] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        당시 보관 명부에서 학생을 선택합니다. 현재 사용하지 않는 이전 계정의
        기록도 보존되어 있습니다.
      </p>
      {students.busy && <p role="status">보관 명부를 불러오는 중입니다.</p>}
      {students.error && (
        <div role="alert">
          <p className="text-red-700">{students.error}</p>
          <button
            className={`${buttonClass} mt-3`}
            disabled={students.busy}
            onClick={() => void students.load(students.cursor)}
          >
            명부 다시 불러오기
          </button>
        </div>
      )}
      <label className="block text-sm font-bold text-gray-800">
        보관 명부 학생
        <select
          className={`${fieldClass} mt-2`}
          value={studentUid}
          onChange={(event) => setStudentUid(event.target.value)}
        >
          <option value="">학생을 선택해 주세요</option>
          {students.rows.map((row, index) => (
            <option key={row.id} value={row.studentUid}>
              {studentLabel(row)} · 보관 명부 {index + 1}
            </option>
          ))}
        </select>
      </label>
      {students.cursor && (
        <button
          className={buttonClass}
          disabled={students.busy}
          onClick={() => void students.load(students.cursor)}
        >
          명부 다음 학생 더 보기
        </button>
      )}
      {students.loaded && !students.rows.length && !students.cursor && (
        <p>이 학기에 보관된 학생 명부가 없습니다.</p>
      )}
      {studentUid && (
        <LegacyList
          key={studentUid}
          semesterId={semesterId}
          kind="grades"
          studentUid={studentUid}
        />
      )}
    </div>
  );
}

export default function LegacyArchiveRecords({
  semesterId,
}: {
  semesterId: string;
}) {
  const [kind, setKind] = useState<VisibleKind>("wis_wallets");
  return (
    <section className="space-y-4 min-w-0" aria-label="기존 보관 기록">
      <p className="text-sm text-gray-600">
        개편 전 방식으로 저장된 기록입니다. 새 학기의 잔액·성적에는 합산되지
        않습니다.
      </p>
      <label className="block text-sm font-bold text-gray-800">
        기존 기록 종류
        <select
          className={`${fieldClass} mt-2`}
          value={kind}
          onChange={(event) => setKind(event.target.value as VisibleKind)}
        >
          {Object.entries(kinds).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {kind === "grades" ? (
        <LegacyGrades key={`${semesterId}:grades`} semesterId={semesterId} />
      ) : (
        <LegacyList
          key={`${semesterId}:${kind}`}
          semesterId={semesterId}
          kind={kind}
        />
      )}
    </section>
  );
}
