import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { ADMIN_EMAIL } from "../../../lib/permissions";
import {
  loadSemesterCoreSnapshot,
  type SemesterManifest,
} from "../../../lib/semesterCore";
import { getArchiveEnrollmentState } from "../../../lib/archiveEnrollment";
import { getWisEconomyState } from "../../../lib/wisEconomy";
import {
  getGradeEvidenceState,
  type GradeEvidenceRecord,
} from "../../../lib/gradeEvidence";
import { getW8DomainState } from "../../../lib/w8Domains";
import {
  appendArchivePage,
  archiveDate,
  assertArchiveResponse,
  getHistoricalSemesters,
} from "../../../lib/semesterArchiveView";
import ResponsiveDataContainer from "../../../components/common/ResponsiveDataContainer";
import LegacyArchiveRecords from "./LegacyArchiveRecords";

const buttonClass =
  "px-4 py-3 rounded-lg border border-gray-200 bg-white text-gray-800 font-bold hover:bg-gray-50 disabled:opacity-60";
const fieldClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-gray-800";
const kinds = {
  roster: "학생 명부",
  wis: "위스 잔액·거래",
  orders: "위스 주문",
  performance: "수행평가",
  written_exam_essay: "서술형 평가",
  schedule: "일정",
  notices: "공지",
  legacy: "기존 보관 기록 (위스·성적·풀이)",
} as const;
type RecordKind = keyof typeof kinds;
interface ArchiveRow {
  id: string;
  cells: React.ReactNode[];
  grade?: GradeEvidenceRecord;
  accountId?: string;
  name?: string;
}
interface ArchivePage {
  rows: ArchiveRow[];
  headers: string[];
  nextCursor: string;
}
const statusLabel = (status: string) =>
  ({
    ACTIVE: "재학",
    PENDING: "대기",
    TRANSFERRED: "전출",
    WITHDRAWN: "탈퇴",
    COMPLETED: "이수",
    REQUESTED: "신청",
    APPROVED: "승인",
    REJECTED: "반려",
    FULFILLED: "지급 완료",
    DRAFT: "초안",
    AUTO_EVALUATED_UNOFFICIAL: "자동 채점",
    TEACHER_REVIEW_REQUIRED: "검토 필요",
    REVIEWED: "검토 완료",
    EVIDENCE_LOCKED: "근거 확정",
    OFFICIAL_PENDING_SIGNATURE: "서명 대기",
    OFFICIAL: "확정",
    CORRECTED: "정정",
    PUBLISHED: "게시",
    ARCHIVED: "보관",
    CLOSED: "종료",
  })[status] || "상태 확인 필요";
const number = (value: number | null) =>
  value === null ? "미입력" : value.toLocaleString("ko-KR");

function GradeDetails({ record }: { record: GradeEvidenceRecord }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer py-2 text-blue-800 font-bold">
        평가 근거·확인 기록
      </summary>
      <div className="space-y-3 py-3 text-sm">
        {record.evidence.length === 0 && <p>저장된 문항별 근거가 없습니다.</p>}
        {record.evidence.map((item) => (
          <div key={item.id} className="border-b border-gray-100 pb-3">
            <p className="font-bold">
              {item.label} · {number(item.score)} / {number(item.maxScore)}점
            </p>
            {item.studentAnswer && (
              <p className="whitespace-pre-wrap break-words">
                학생 답안: {item.studentAnswer}
              </p>
            )}
            {item.summary && (
              <p className="whitespace-pre-wrap break-words">{item.summary}</p>
            )}
          </div>
        ))}
        {record.requests.map((request) => (
          <p key={request.id} className="whitespace-pre-wrap break-words">
            확인 요청: {request.reason || "내용 없음"}
            {request.response ? ` / 답변: ${request.response}` : ""}
          </p>
        ))}
        {record.attestations.map((item) => (
          <p key={item.id}>
            {item.kind === "SIGNATURE" ? "서명" : "확인"}:{" "}
            {item.signerName || "이름 기록 없음"} · {archiveDate(item.signedAt)}
          </p>
        ))}
      </div>
    </details>
  );
}

function ArchiveRecords({
  semesterId,
  kind,
  accountId,
  accountName,
}: {
  semesterId: string;
  kind: Exclude<RecordKind, "legacy">;
  accountId?: string;
  accountName?: string;
}) {
  const { config } = useAuth();
  const [page, setPage] = useState<ArchivePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const requestEpoch = useRef(0);
  const load = useCallback(
    async (cursor = "") => {
      const epoch = ++requestEpoch.current;
      setBusy(true);
      setError("");
      try {
        let result: ArchivePage;
        if (kind === "roster") {
          const data = assertArchiveResponse(
            await getArchiveEnrollmentState({
              source: "ARCHIVE",
              semesterId,
              callSite: "SettingsArchiveRecords.roster",
            }),
            semesterId,
          );
          result = {
            headers: ["학급", "번호", "이름", "학적"],
            nextCursor: "",
            rows: data.enrollments.map((row) => {
              const snapshot = row.snapshot;
              const classroom = data.classes.find(
                (item) => item.classId === row.classId,
              );
              return {
                id: row.enrollmentId || row.studentUid,
                cells: [
                  snapshot?.classDisplayName ||
                    classroom?.displayName ||
                    [
                      snapshot?.grade || row.grade,
                      snapshot?.classNumber || row.classNumber,
                    ]
                      .filter(Boolean)
                      .join(" / ") ||
                    "학급 기록 없음",
                  snapshot?.studentNumber || row.studentNumber || "—",
                  snapshot?.displayName || row.displayName || "이름 기록 없음",
                  statusLabel(row.enrollmentStatus || ""),
                ],
              };
            }),
          };
        } else if (kind === "wis" || kind === "orders") {
          const data = assertArchiveResponse(
            await getWisEconomyState({
              config,
              audience: "teacher",
              semesterId,
              provenance: "ARCHIVE",
              projection:
                kind === "orders"
                  ? "orders"
                  : accountId
                    ? "account"
                    : "overview",
              accountId,
              cursor,
              limit: 50,
            }),
            semesterId,
          );
          result = accountId
            ? {
                headers: ["일시", "내용", "변동", "거래 후 잔액"],
                nextCursor: data.nextCursor,
                rows: data.ledger.map((row) => ({
                  id: row.ledgerEntryId,
                  cells: [
                    archiveDate(row.createdAt),
                    row.type === "INITIAL_GRANT"
                      ? "학기 시작 위스 지급"
                      : row.reason || "위스 거래",
                    `${row.delta > 0 ? "+" : ""}${number(row.delta)}`,
                    number(row.balanceAfter),
                  ],
                })),
              }
            : kind === "orders"
              ? {
                  headers: ["신청일", "학생", "상품", "금액", "처리"],
                  nextCursor: data.nextCursor,
                  rows: data.orders.map((row) => ({
                    id: row.orderId,
                    cells: [
                      archiveDate(row.createdAt),
                      data.accounts.find(
                        (account) => account.accountId === row.accountId,
                      )?.displayName || "이름 기록 없음",
                      `${row.productName} × ${row.quantity}`,
                      number(row.totalPrice),
                      statusLabel(row.status),
                    ],
                  })),
                }
              : {
                  headers: ["학급·번호", "학생", "잔액", "누적 적립", "사용"],
                  nextCursor: data.nextCursor,
                  rows: data.accounts.map((row) => ({
                    id: row.accountId,
                    accountId: row.accountId,
                    name: row.displayName,
                    cells: [
                      `${row.grade}학년 ${row.classNumber}반 ${row.studentNumber}번`,
                      row.displayName,
                      number(row.balance),
                      number(row.earnedTotal),
                      number(row.spentTotal),
                    ],
                  })),
                };
        } else if (kind === "performance" || kind === "written_exam_essay") {
          const data = assertArchiveResponse(
            await getGradeEvidenceState({
              config,
              audience: "teacher",
              semesterId,
              provenance: "ARCHIVE",
              scoreKind: kind,
              cursor,
            }),
            semesterId,
          );
          result = {
            headers: ["학생", "평가", "점수", "상태"],
            nextCursor: data.nextCursor,
            rows: data.records.map((row) => ({
              id: row.headId,
              grade: row,
              cells: [
                `${row.enrollmentLabel} ${row.studentName}`,
                row.title || row.assessmentLabel || "평가",
                `${number(row.score)} / ${number(row.maxScore)}`,
                statusLabel(row.status),
              ],
            })),
          };
        } else {
          const data = assertArchiveResponse(
            await getW8DomainState({
              config,
              audience: "teacher",
              semesterId,
              source: "ARCHIVE",
              domain: kind === "schedule" ? "SCHEDULE" : "COMMUNICATION",
            }),
            semesterId,
          );
          result =
            kind === "schedule"
              ? {
                  headers: ["일정", "시작", "종료", "내용"],
                  nextCursor: "",
                  rows: data.scheduleEvents.map((row) => ({
                    id: row.eventId,
                    cells: [
                      row.title,
                      archiveDate(row.startAt),
                      archiveDate(row.endAt),
                      row.description,
                    ],
                  })),
                }
              : {
                  headers: ["제목", "내용", "상태"],
                  nextCursor: "",
                  rows: data.notices.map((row) => ({
                    id: row.noticeId,
                    cells: [row.title, row.content, statusLabel(row.status)],
                  })),
                };
        }
        if (epoch === requestEpoch.current)
          setPage((previous) =>
            cursor && previous
              ? {
                  ...result,
                  rows: appendArchivePage(
                    previous.rows,
                    result.rows,
                    (row) => row.id,
                  ),
                }
              : result,
          );
      } catch {
        if (epoch === requestEpoch.current)
          setError(
            "기록을 불러오지 못했습니다. 로그인 상태와 네트워크를 확인한 뒤 다시 시도해 주세요.",
          );
      } finally {
        if (epoch === requestEpoch.current) setBusy(false);
      }
    },
    [accountId, config, kind, semesterId],
  );
  useEffect(() => {
    void load();
    return () => {
      requestEpoch.current += 1;
    };
  }, [load]);

  return (
    <section
      aria-label={accountId ? `${accountName} 최근 위스 거래` : kinds[kind]}
      className="min-w-0 space-y-4"
    >
      {accountId && (
        <h4 className="font-bold text-gray-800">{accountName} · 최근 거래</h4>
      )}
      {!accountId && (
        <p className="text-sm text-gray-600">
          선택한 학기에 연결된 기록입니다. 기존 방식으로 저장한 자료는 별도 보관
          기록에서 확인해야 합니다.
        </p>
      )}
      {error && (
        <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-700">
          <p>{error}</p>
          <button
            className={`${buttonClass} mt-3`}
            disabled={busy}
            onClick={() => void load(page?.nextCursor || "")}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="text-gray-600">
          기록을 불러오는 중입니다.
        </p>
      )}
      {page && (
        <>
          <p className="text-sm text-gray-600">
            불러온 기록 {page.rows.length.toLocaleString("ko-KR")}건
            {page.nextCursor ? " · 다음 기록이 있습니다." : ""}
          </p>
          {page.rows.length === 0 ? (
            <p className="py-6 text-gray-600">
              이 목록에 연결된 기록이 없습니다.
              {page.nextCursor ? " 다음 기록도 확인해 주세요." : ""}
            </p>
          ) : (
            <ResponsiveDataContainer
              label={accountId ? "학생 최근 거래" : kinds[kind]}
            >
              <table className="w-full text-sm text-left text-gray-800">
                <thead className="bg-gray-50">
                  <tr>
                    {page.headers.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="p-3 whitespace-nowrap font-bold"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr className="border-b border-gray-100">
                        {row.cells.map((cell, index) => (
                          <td
                            key={index}
                            className="p-3 align-top whitespace-pre-wrap break-words"
                          >
                            {cell}
                            {index === 1 && row.accountId && (
                              <button
                                className="block py-3 font-bold text-blue-800"
                                onClick={() =>
                                  setSelectedAccount({
                                    id: row.accountId!,
                                    name: row.name || "학생",
                                  })
                                }
                              >
                                최근 거래 보기
                              </button>
                            )}
                          </td>
                        ))}
                      </tr>
                      {row.grade && (
                        <tr className="border-b border-gray-200">
                          <td
                            colSpan={page.headers.length}
                            className="px-3 pb-3"
                          >
                            <GradeDetails record={row.grade} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </ResponsiveDataContainer>
          )}
          {page.nextCursor && (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void load(page.nextCursor)}
            >
              다음 기록 더 보기
            </button>
          )}
        </>
      )}
      {selectedAccount && (
        <div className="border-t border-gray-200 pt-6 space-y-4">
          <button
            className={buttonClass}
            onClick={() => setSelectedAccount(null)}
          >
            최근 거래 닫기
          </button>
          <ArchiveRecords
            key={selectedAccount.id}
            semesterId={semesterId}
            kind="wis"
            accountId={selectedAccount.id}
            accountName={selectedAccount.name}
          />
        </div>
      )}
    </section>
  );
}

const SettingsArchiveRecords: React.FC = () => {
  const { currentUser, config } = useAuth();
  const [params, setParams] = useSearchParams();
  const [manifests, setManifests] = useState<SemesterManifest[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<RecordKind>("roster");
  const admin = currentUser?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const currentSemesterId =
    config?.year && config?.semester ? `${config.year}-${config.semester}` : "";
  const historical = getHistoricalSemesters(manifests, currentSemesterId);
  const requested = params.get("semesterId") || "";
  const selected =
    historical.find((item) => item.semesterId === requested) ||
    (!requested ? historical[0] : undefined);
  useEffect(() => {
    if (!admin) {
      setBusy(false);
      return;
    }
    let current = true;
    setBusy(true);
    setError("");
    void loadSemesterCoreSnapshot()
      .then((snapshot) => {
        if (current) setManifests(snapshot.manifests);
      })
      .catch(() => {
        if (current)
          setError("지난 학기 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [admin, reload]);
  useEffect(() => {
    if (selected && !requested) {
      const next = new URLSearchParams(params);
      next.set("semesterId", selected.semesterId);
      setParams(next, { replace: true });
    }
  }, [params, requested, selected, setParams]);
  if (!admin)
    return <p role="alert">지난 학기 기록은 관리자만 확인할 수 있습니다.</p>;
  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-gray-800">지난 학기 기록</h2>
        <p className="mt-2 text-sm text-gray-600">
          종료한 학기의 기록을 읽기 전용으로 확인합니다. 현재 운영 학기는 바뀌지
          않습니다.
        </p>
      </div>
      {busy && <p role="status">학기 목록을 불러오는 중입니다.</p>}
      {error && (
        <div role="alert">
          <p className="text-red-700">{error}</p>
          <button
            className={`${buttonClass} mt-3`}
            onClick={() => setReload((value) => value + 1)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {!busy && !error && historical.length === 0 && (
        <p className="text-gray-600">
          아직 종료된 학기가 없습니다. 학기 전환이 완료되면 이곳에서 이전 기록을
          확인할 수 있습니다.
        </p>
      )}
      {!busy && !error && historical.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-sm font-bold text-gray-800">
              조회 학기
              <select
                className={`${fieldClass} mt-2`}
                value={selected?.semesterId || ""}
                onChange={(event) => {
                  const next = new URLSearchParams(params);
                  next.set("semesterId", event.target.value);
                  setParams(next, { replace: true });
                }}
              >
                <option value="" disabled>
                  학기를 선택해 주세요
                </option>
                {historical.map((item) => (
                  <option key={item.semesterId} value={item.semesterId}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-gray-800">
              기록 종류
              <select
                className={`${fieldClass} mt-2`}
                value={kind}
                onChange={(event) => setKind(event.target.value as RecordKind)}
              >
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!selected ? (
            <p role="alert" className="text-red-700">
              선택한 학기는 보관 기록으로 조회할 수 없습니다. 종료된 학기를
              선택해 주세요.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                {selected.startDate || "시작일 미등록"} ~{" "}
                {selected.endDate || "종료일 미등록"} · 읽기 전용
              </p>
              {kind === "legacy" ? (
                <LegacyArchiveRecords
                  key={selected.semesterId}
                  semesterId={selected.semesterId}
                />
              ) : (
                <ArchiveRecords
                  key={`${selected.semesterId}:${kind}`}
                  semesterId={selected.semesterId}
                  kind={kind}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
export default SettingsArchiveRecords;
