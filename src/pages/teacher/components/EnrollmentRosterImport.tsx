import React, { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import {
  getArchiveEnrollmentState,
  previewEnrollmentRoster,
  type ArchiveEnrollmentState,
  type RosterPreviewResult,
} from "../../../lib/archiveEnrollment";
import {
  executeWestoryCommand,
  WestoryCommandError,
  type EnrollmentRosterPayload,
} from "../../../lib/commandGateway";
import type { SemesterManifest } from "../../../lib/semesterCore";
import { getServerSemesterCoreState } from "../../../lib/semesterCore";
import {
  buildEnrollmentRosterFormPayload,
  enrollmentName,
  getRosterCandidates,
} from "../../../lib/enrollmentRosterForm";
import ResponsiveDataContainer from "../../../components/common/ResponsiveDataContainer";
import { PageDataLoading } from "../../../components/common/LoadingState";

const field =
  "mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 disabled:bg-gray-100";
const button =
  "rounded-lg border border-gray-200 bg-white px-4 py-3 font-bold text-gray-800 disabled:opacity-50";
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export default function EnrollmentRosterImport({
  manifest,
  state,
  manifests,
  onApplied,
  onBusy,
}: {
  manifest: SemesterManifest;
  state: ArchiveEnrollmentState;
  manifests: SemesterManifest[];
  onApplied: () => void;
  onBusy: (value: boolean) => void;
}) {
  const { currentUser, userData } = useAuth();
  const sources = manifests.filter(
    (row) =>
      row.semesterId !== manifest.semesterId &&
      ["ACTIVE", "CLOSED", "ARCHIVED"].includes(row.status),
  );
  const [sourceId, setSourceId] = useState(sources[0]?.semesterId || "");
  const [source, setSource] = useState<ArchiveEnrollmentState | null>(null);
  const [sourceClassId, setSourceClassId] = useState("");
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [teacherUid, setTeacherUid] = useState(currentUser?.uid || "");
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(manifest.startDate || "");
  const [preview, setPreview] = useState<RosterPreviewResult | null>(null);
  const [payload, setPayload] = useState<EnrollmentRosterPayload | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const flight = useRef<{
    commandId: string;
    payload: EnrollmentRosterPayload & { validationHash: string };
  } | null>(null);
  const running = useRef(false);
  const candidates = source
    ? getRosterCandidates(source, state, sourceClassId)
    : [];
  const existingClass = state.classes.find(
    (row) => row.grade === grade && row.classNumber === classNumber,
  );
  const teacherIds = [
    ...new Set(
      [
        currentUser?.uid || "",
        ...state.classes.map((row) => row.homeroomTeacherUid),
        ...(source?.classes.map((row) => row.homeroomTeacherUid) || []),
      ].filter(Boolean),
    ),
  ];
  const invalidate = () => {
    setPreview(null);
    setPayload(null);
    setConfirmed(false);
    setError("");
    setMessage("");
  };
  useEffect(() => {
    let active = true;
    setSource(null);
    setSourceClassId("");
    setSelected([]);
    invalidate();
    if (!sourceId) return;
    setLoading(true);
    void getArchiveEnrollmentState({
      source: "EXPLICIT",
      semesterId: sourceId,
      callSite: "EnrollmentRosterImport.source",
    })
      .then((next) => {
        if (!active) return;
        if (next.semesterId !== sourceId || next.legacy)
          throw new Error("명부 학기를 확인하지 못했습니다.");
        setSource(next);
      })
      .catch(() => {
        if (active)
          setError(
            "이전 명부를 불러오지 못했습니다. 다른 학기를 선택한 뒤 다시 시도해 주세요.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceId]);
  useEffect(() => {
    let active = true;
    void Promise.all(
      teacherIds.map(async (uid) => {
        if (uid === currentUser?.uid)
          return [uid, `${userData?.name || "관리자"} (나)`] as const;
        try {
          const snapshot = await getDoc(doc(db, "users", uid));
          return [
            uid,
            String(snapshot.data()?.name || "기존 담당 교사"),
          ] as const;
        } catch {
          return [uid, "기존 담당 교사"] as const;
        }
      }),
    ).then((names) => {
      if (active) setTeacherNames(Object.fromEntries(names));
    });
    return () => {
      active = false;
    };
  }, [teacherIds.join("|"), currentUser?.uid, userData?.name]);
  const chooseClass = (classId: string) => {
    invalidate();
    setSourceClassId(classId);
    setSelected([]);
    const row = source?.classes.find((item) => item.classId === classId);
    if (!row || !source) return;
    setGrade(row.grade);
    setClassNumber(row.classNumber);
    const existing = state.classes.find(
      (item) => item.classKey === row.classKey,
    );
    setTeacherUid(
      existing?.homeroomTeacherUid ||
        row.homeroomTeacherUid ||
        currentUser?.uid ||
        "",
    );
    setNumbers(
      Object.fromEntries(
        getRosterCandidates(source, state, classId).map((item) => [
          item.studentUid,
          item.studentNumber,
        ]),
      ),
    );
  };
  const validate = async () => {
    if (running.current || !source) return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setPayload(null);
    setConfirmed(false);
    try {
      const core = await getServerSemesterCoreState(manifest.semesterId);
      if (!core.requested || core.requested.semesterId !== manifest.semesterId)
        throw new Error("학기 상태를 다시 불러와 주세요.");
      const next = buildEnrollmentRosterFormPayload({
        manifest: core.requested,
        targetState: state,
        sourceState: source,
        sourceClassId,
        selectedUids: selected,
        numbers,
        targetClass: {
          grade,
          classNumber,
          displayName:
            existingClass?.displayName || `${grade}학년 ${classNumber}반`,
          homeroomTeacherUid: existingClass?.homeroomTeacherUid || teacherUid,
        },
        effectiveFrom,
        rosterId: `admin-roster-${crypto.randomUUID()}`,
        sourceHash: "0".repeat(64),
      });
      next.sourceHash = await digest(
        JSON.stringify({
          sourceSemester: source.semesterId,
          classes: next.classes,
          entries: next.entries,
          effectiveFrom,
        }),
      );
      const result = await previewEnrollmentRoster(next);
      if (
        result.semesterId !== next.semesterId ||
        result.rosterId !== next.rosterId ||
        result.writeCount !== 0
      )
        throw new Error(
          "명단 확인 결과가 일치하지 않습니다. 다시 확인해 주세요.",
        );
      setPreview(result);
      setPayload(next);
      setMessage(
        result.passed
          ? "명단 확인을 마쳤습니다. 아래 인원과 학급을 확인한 뒤 등록해 주세요."
          : "명단에서 확인할 항목을 발견했습니다. 아래 내용을 수정한 뒤 다시 확인해 주세요.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error && /[가-힣]/u.test(cause.message)
          ? cause.message
          : "명단을 확인하지 못했습니다. 학기와 학생 정보를 다시 확인해 주세요.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(Boolean(flight.current));
    }
  };
  const apply = async () => {
    if (
      running.current ||
      (!flight.current && (!payload || !preview?.passed || !confirmed))
    )
      return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    if (!flight.current)
      flight.current = {
        commandId: crypto.randomUUID(),
        payload: { ...payload!, validationHash: preview!.validationHash },
      };
    try {
      const result = await executeWestoryCommand(
        "importEnrollmentRoster",
        flight.current.payload,
        { commandId: flight.current.commandId },
      );
      flight.current = null;
      setUncertain(false);
      setPreview(null);
      setPayload(null);
      setConfirmed(false);
      setSelected([]);
      setMessage(
        `학생 ${result.result.createdEnrollmentCount}명의 명부를 등록했습니다. 기존 학기의 기록은 보존됩니다.`,
      );
      onApplied();
    } catch (cause) {
      const pending =
        !(cause instanceof WestoryCommandError) || !cause.outcomeConfirmed;
      setUncertain(pending);
      if (!pending) {
        flight.current = null;
        setPreview(null);
        setPayload(null);
        setConfirmed(false);
      }
      setError(
        pending
          ? "등록 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 ‘등록 결과 다시 확인’을 눌러 주세요."
          : "명부를 등록하지 못했습니다. 최신 명부를 불러온 뒤 다시 확인해 주세요.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(Boolean(flight.current));
    }
  };
  const locked = busy || uncertain;
  return (
    <section className="space-y-4" aria-label="이전 명부 가져오기">
      <div>
        <h3 className="text-lg font-bold text-gray-800">이전 명부 가져오기</h3>
        <p className="mt-2 text-sm text-gray-600">
          기존 학생을 학급별로 선택해 새 명부에 등록합니다. 이미 등록된 학생은
          제외하며, 한 번에 최대 120명을 확인합니다. 새로 가입한 학생은 ‘등록
          승인’에서 처리해 주세요.
        </p>
      </div>
      {message && (
        <p role="status" className="rounded-lg bg-blue-50 p-4 text-blue-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}
      <fieldset disabled={locked} className="space-y-4">
        <legend className="font-bold text-gray-800">1. 가져올 명부 선택</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">
            이전 학기
            <select
              className={field}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">학기 선택</option>
              {sources.map((row) => (
                <option key={row.semesterId} value={row.semesterId}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            이전 학급
            <select
              className={field}
              value={sourceClassId}
              onChange={(event) => chooseClass(event.target.value)}
              disabled={loading || !source}
            >
              <option value="">학급 선택</option>
              {source?.classes.map((row) => (
                <option key={row.classId} value={row.classId}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading && <PageDataLoading />}
        {sourceClassId && (
          <>
            <p className="text-sm text-gray-600">
              등록 가능한 학생 {candidates.length}명 · 선택 {selected.length}명
            </p>
            <button
              type="button"
              className={button}
              onClick={() => {
                invalidate();
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.slice(0, 120).map((row) => row.studentUid),
                );
              }}
            >
              {selected.length === candidates.length
                ? "전체 선택 해제"
                : "전체 선택 (최대 120명)"}
            </button>
            <ResponsiveDataContainer label="가져올 학생 명단">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-3" scope="col">
                      선택
                    </th>
                    <th className="p-3" scope="col">
                      학생
                    </th>
                    <th className="p-3" scope="col">
                      새 번호
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => (
                    <tr
                      key={row.studentUid}
                      className="border-b border-gray-100"
                    >
                      <td className="p-3">
                        <label className="inline-flex p-3">
                          <input
                            type="checkbox"
                            aria-label={`${enrollmentName(row)} 등록 선택`}
                            checked={selected.includes(row.studentUid)}
                            onChange={(event) => {
                              invalidate();
                              setSelected(
                                event.target.checked
                                  ? [...selected, row.studentUid]
                                  : selected.filter(
                                      (uid) => uid !== row.studentUid,
                                    ),
                              );
                            }}
                          />
                        </label>
                      </td>
                      <td className="p-3">{enrollmentName(row)}</td>
                      <td className="p-3">
                        <input
                          className={field}
                          type="number"
                          min="1"
                          max="999"
                          aria-label={`${enrollmentName(row)} 새 번호`}
                          value={numbers[row.studentUid] || ""}
                          onChange={(event) => {
                            invalidate();
                            setNumbers({
                              ...numbers,
                              [row.studentUid]: event.target.value,
                            });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveDataContainer>
            {!candidates.length && (
              <p className="text-gray-600">
                이 학급의 학생은 이미 등록되었거나 가져올 수 있는 명부가
                없습니다.
              </p>
            )}
          </>
        )}
        <p className="font-bold text-gray-800">2. 등록할 학급 확인</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">
            학년
            <input
              className={field}
              type="number"
              min="1"
              max="99"
              value={grade}
              onChange={(event) => {
                invalidate();
                setGrade(event.target.value);
              }}
            />
          </label>
          <label className="text-sm font-bold">
            반
            <input
              className={field}
              type="number"
              min="1"
              max="99"
              value={classNumber}
              onChange={(event) => {
                invalidate();
                setClassNumber(event.target.value);
              }}
            />
          </label>
          <label className="text-sm font-bold">
            담당 교사
            <select
              className={field}
              value={existingClass?.homeroomTeacherUid || teacherUid}
              disabled={!!existingClass}
              onChange={(event) => {
                invalidate();
                setTeacherUid(event.target.value);
              }}
            >
              {teacherIds.map((uid) => (
                <option key={uid} value={uid}>
                  {teacherNames[uid] || "담당 교사 확인 중"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            적용 날짜
            <input
              className={field}
              type="date"
              min={manifest.startDate || undefined}
              max={manifest.endDate || undefined}
              value={effectiveFrom}
              onChange={(event) => {
                invalidate();
                setEffectiveFrom(event.target.value);
              }}
            />
          </label>
        </div>
        {existingClass && (
          <p className="text-sm text-gray-600">
            이미 있는 {existingClass.displayName}에 등록합니다. 학급 이름과 담당
            교사는 기존 설정을 사용합니다.
          </p>
        )}
        <button
          type="button"
          className={button}
          disabled={loading || !selected.length}
          onClick={() => void validate()}
        >
          {busy ? "확인 중…" : "명단 확인하기"}
        </button>
      </fieldset>
      {preview && (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <p className="font-bold">
            확인 결과: 학생 {preview.summary.expectedStudentCount}명 · 학급{" "}
            {preview.summary.classCount}개
          </p>
          {Object.entries({
            "중복 학생": preview.summary.duplicateStudentCount,
            "중복 번호": preview.summary.duplicateStudentNumberCount,
            "학생 계정 확인 필요": preview.summary.orphanStudentCount,
            "담당 교사 확인 필요": preview.summary.orphanTeacherCount,
            "학급 설정 확인 필요":
              preview.summary.existingClassConflictCount +
              preview.summary.orphanClassCount,
            "누락 학생": preview.summary.missingStudentCount,
          })
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <p key={label} className="text-red-700">
                {label}: {count}명/건
              </p>
            ))}
          {preview.passed && (
            <label className="flex items-start gap-3 py-3">
              <input
                className="mt-1"
                type="checkbox"
                checked={confirmed}
                disabled={locked}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                {manifest.displayName} {payload?.classes[0].displayName}에 학생{" "}
                {payload?.entries.length}명을 등록하는 내용을 확인했습니다.
              </span>
            </label>
          )}
        </div>
      )}
      {(preview?.passed || uncertain) && (
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          disabled={busy || (!uncertain && !confirmed)}
          onClick={() => void apply()}
        >
          {busy
            ? "처리 중…"
            : uncertain
              ? "등록 결과 다시 확인"
              : "확인한 명부 등록"}
        </button>
      )}
    </section>
  );
}
