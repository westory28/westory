import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  getAdminSemesterContent,
  type AdminSemesterContentRow,
  type AdminSemesterContentType,
} from "../../../lib/adminSemesterContent";
import {
  appendArchivePage,
  archiveDate,
} from "../../../lib/semesterArchiveView";
import { PageDataLoading } from "../../../components/common/LoadingState";
import ArchivedLessonPreview from "./ArchivedLessonPreview";
import QuizPassage from "../../../components/common/QuizPassage";

export const archiveContentGroups = {
  lessons: "수업 자료",
  think_cloud: "생각모아",
  dictionary: "역사 사전",
  assessments: "평가 자료",
} as const;
export type ArchiveContentGroup = keyof typeof archiveContentGroups;
const contentKinds: Record<
  ArchiveContentGroup,
  { type: AdminSemesterContentType; label: string }[]
> = {
  lessons: [{ type: "lessons", label: "수업 자료" }],
  think_cloud: [{ type: "think_cloud_sessions", label: "생각모아 활동" }],
  dictionary: [
    { type: "history_dictionary_terms", label: "사전 단어" },
    { type: "history_dictionary_requests", label: "단어 등록 요청" },
    { type: "dictionary_words", label: "학생 단어장" },
  ],
  assessments: [
    { type: "quiz_questions", label: "평가 문제" },
    { type: "history_classrooms", label: "역사교실" },
    { type: "assessment_config", label: "평가 설정" },
    { type: "exam_config", label: "정기시험 답안 설정" },
    { type: "grading_plans", label: "평가 반영 비율" },
  ],
};
const buttonClass =
  "px-4 py-3 rounded-lg border border-gray-200 bg-white text-gray-800 font-bold hover:bg-gray-50 disabled:opacity-60";
const fieldClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-gray-800";
type Detail = Record<string, unknown>;
const record = (value: unknown): Detail =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Detail)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const statusLabel = (value: string) =>
  ({
    active: "진행 중",
    draft: "준비",
    paused: "일시 중지",
    closed: "종료",
    approved: "승인",
    rejected: "반려",
    pending: "대기",
    published: "공개",
    archived: "보관",
  })[value.toLowerCase()] || "보관 자료";
const imageUrl = (value: unknown) => {
  const url = text(value);
  return /^https:\/\//i.test(url) ||
    /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(url)
    ? url
    : "";
};

function Description({ label, value }: { label: string; value: unknown }) {
  const content = text(value);
  if (!content) return null;
  return (
    <div>
      <dt className="font-bold text-gray-800">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-gray-800">
        {content}
      </dd>
    </div>
  );
}

function ContentDetails({
  contentType,
  detail,
  semesterId,
}: {
  contentType: AdminSemesterContentType;
  detail: Detail;
  semesterId: string;
}) {
  if (contentType === "lessons")
    return <ArchivedLessonPreview lesson={detail} semesterId={semesterId} />;
  if (contentType === "quiz_questions")
    return (
      <div className="space-y-4">
        <dl className="space-y-4">
          <Description label="문제" value={detail.question} />
        </dl>
        {text(detail.passage) && <QuizPassage value={text(detail.passage)} />}
        {imageUrl(detail.image) && (
          <img
            src={imageUrl(detail.image)}
            alt="문제 자료"
            className="max-w-full rounded-lg"
          />
        )}
        {list(detail.options).length > 0 && (
          <ol className="list-decimal pl-6 space-y-2">
            {list(detail.options).map((option, index) => (
              <li key={index} className="whitespace-pre-wrap break-words">
                {text(option)}
              </li>
            ))}
          </ol>
        )}
        {list(detail.choiceOptionImages).map((image, index) => {
          const source = record(image);
          const url = imageUrl(
            typeof image === "string"
              ? image
              : source.url || source.imageUrl || source.image,
          );
          return url ? (
            <figure key={index}>
              <figcaption className="mb-2 text-sm font-bold">
                보기 {index + 1}
              </figcaption>
              <img
                src={url}
                alt={`보기 ${index + 1} 자료`}
                className="max-w-full rounded-lg"
              />
            </figure>
          ) : null;
        })}
        {list(detail.matchingPairs).length > 0 && (
          <div>
            <h4 className="font-bold">연결 항목</h4>
            <ul className="mt-2 space-y-2">
              {list(detail.matchingPairs).map((pair, index) => (
                <li key={index}>
                  {text(record(pair).left)} → {text(record(pair).right)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="space-y-4">
          <Description label="정답" value={detail.answer} />
          <Description label="해설" value={detail.explanation} />
          <Description label="힌트" value={detail.hint} />
        </dl>
      </div>
    );
  if (
    [
      "history_dictionary_terms",
      "history_dictionary_requests",
      "dictionary_words",
    ].includes(contentType)
  )
    return (
      <dl className="space-y-4">
        <Description label="단어" value={detail.word || detail.term} />
        <Description label="뜻" value={detail.definition || detail.meaning} />
        <Description
          label="예문"
          value={detail.example || detail.exampleSentence}
        />
        <Description
          label="요청 내용"
          value={detail.memo || detail.reason || detail.requestReason}
        />
        <Description
          label="검토 의견"
          value={detail.reviewMemo || detail.rejectionReason}
        />
        <Description
          label="등록일"
          value={detail.createdAt ? archiveDate(text(detail.createdAt)) : ""}
        />
      </dl>
    );
  if (
    contentType === "think_cloud_sessions" ||
    contentType === "think_cloud_responses"
  )
    return (
      <dl className="space-y-4">
        <Description label="활동 설명" value={detail.description} />
        <Description
          label="응답"
          value={detail.textRaw || detail.textNormalized}
        />
        <Description label="학생" value={detail.displayName} />
        <Description
          label="대상"
          value={[
            detail.targetGradeLabel ||
              (detail.targetGrade ? `${text(detail.targetGrade)}학년` : ""),
            detail.targetClassLabel ||
              (detail.targetClass ? `${text(detail.targetClass)}반` : ""),
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </dl>
    );
  if (contentType === "history_classrooms")
    return (
      <div className="space-y-4">
        <dl className="space-y-4">
          <Description label="설명" value={detail.description} />
          <Description label="자료" value={detail.mapTitle} />
          <Description label="응시 시간 (분)" value={detail.timeLimitMinutes} />
        </dl>
        {list(detail.pdfPageImages).map((page, index) => {
          const value = record(page);
          const url = imageUrl(value.url || value.imageUrl);
          return url ? (
            <img
              key={index}
              src={url}
              alt={`역사교실 ${index + 1}쪽`}
              className="max-w-full rounded-lg"
              loading="lazy"
            />
          ) : null;
        })}
        {list(detail.blanks).length > 0 && (
          <div>
            <h4 className="font-bold">빈칸 정답</h4>
            <ol className="mt-2 list-decimal pl-6 space-y-2">
              {list(detail.blanks).map((blank, index) => (
                <li key={index}>{text(record(blank).answer)}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  if (contentType === "exam_config")
    return (
      <div className="space-y-4">
        <h4 className="font-bold">객관식 정답·배점</h4>
        <ol className="list-decimal pl-6 space-y-2">
          {list(detail.objective).map((item, index) => (
            <li key={index}>
              정답 {text(record(item).answer) || "미입력"} ·{" "}
              {text(record(item).score) || "0"}점
            </li>
          ))}
        </ol>
        <h4 className="font-bold">서술형 정답·배점</h4>
        <ol className="list-decimal pl-6 space-y-3">
          {list(detail.subjective).map((item, index) => (
            <li key={index}>
              {list(record(item).subItems).map((sub, subIndex) => (
                <p key={subIndex} className="whitespace-pre-wrap break-words">
                  ({subIndex + 1}) {text(record(sub).answer) || "정답 미입력"} ·{" "}
                  {text(record(sub).score) || "0"}점
                </p>
              ))}
            </li>
          ))}
        </ol>
        {!list(detail.objective).length && !list(detail.subjective).length && (
          <p className="text-gray-600">저장된 정답 항목이 없습니다.</p>
        )}
      </div>
    );
  if (contentType === "grading_plans")
    return (
      <div className="space-y-4">
        <dl>
          <Description label="과목" value={detail.subject} />
        </dl>
        <ul className="divide-y divide-gray-100">
          {list(detail.items).map((item, index) => {
            const entry = record(item);
            return (
              <li key={index} className="py-3">
                <p className="font-bold">
                  {text(entry.name) || `평가 ${index + 1}`}
                </p>
                <p>
                  만점 {text(entry.maxScore) || "0"}점 · 반영 비율{" "}
                  {text(entry.ratio) || "0"}%
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    );
  const settings = Object.values(detail)
    .filter(
      (value) => value && typeof value === "object" && !Array.isArray(value),
    )
    .map(record);
  return (
    <div className="space-y-4">
      <dl>
        <Description label="성적 확인 안내" value={detail.warningText} />
      </dl>
      {settings.map((entry, index) => (
        <section key={index} className="border-b border-gray-100 pb-4">
          <h4 className="font-bold">
            {text(entry.title || entry.name) || `평가 설정 ${index + 1}`}
          </h4>
          <dl className="mt-2 space-y-2">
            <Description label="문항 수" value={entry.questionCount} />
            <Description
              label="응시 시간 (분)"
              value={entry.timeLimitMinutes ?? entry.timeLimit}
            />
            <Description
              label="통과 기준 (%)"
              value={entry.passThresholdPercent ?? entry.passThreshold}
            />
            <Description
              label="재응시 대기 (분)"
              value={entry.cooldownMinutes ?? entry.cooldown}
            />
            <Description label="최대 응시 횟수" value={entry.maxAttempts} />
            <Description
              label="학생 공개"
              value={
                typeof entry.active === "boolean"
                  ? entry.active
                    ? "공개"
                    : "비공개"
                  : ""
              }
            />
            <Description
              label="재응시"
              value={
                typeof entry.allowRetake === "boolean"
                  ? entry.allowRetake
                    ? "허용"
                    : "허용하지 않음"
                  : ""
              }
            />
            <Description
              label="공개 학급"
              value={list(entry.visibleClassIds).map(text).join(", ")}
            />
          </dl>
        </section>
      ))}
      {!settings.length && !text(detail.warningText) && (
        <p className="text-gray-600">저장된 평가 설정 항목이 없습니다.</p>
      )}
    </div>
  );
}

function ContentList({
  semesterId,
  contentType,
  parentId,
}: {
  semesterId: string;
  contentType: AdminSemesterContentType;
  parentId?: string;
}) {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<AdminSemesterContentRow[]>([]);
  const [cursor, setCursor] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AdminSemesterContentRow | null>(
    null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [responsesOpen, setResponsesOpen] = useState(false);
  const epoch = useRef(0);
  const detailEpoch = useRef(0);
  const uid = currentUser?.uid || "";
  const load = useCallback(
    async (next = "") => {
      const request = ++epoch.current;
      if (!uid) return;
      setBusy(true);
      setError("");
      try {
        const page = await getAdminSemesterContent({
          semesterId,
          contentType,
          ...(parentId ? { parentId } : {}),
          ...(next ? { cursor: next } : {}),
        });
        if (request !== epoch.current) return;
        setRows((previous) =>
          next
            ? appendArchivePage(previous, page.rows, (row) => row.id)
            : page.rows,
        );
        setCursor(page.nextCursor || "");
        setLoaded(true);
      } catch {
        if (request === epoch.current)
          setError(
            "지난 학기 자료를 불러오지 못했습니다. 로그인 상태와 네트워크를 확인한 뒤 다시 시도해 주세요.",
          );
      } finally {
        if (request === epoch.current) setBusy(false);
      }
    },
    [semesterId, contentType, parentId, uid],
  );
  useEffect(() => {
    setRows([]);
    setCursor("");
    setLoaded(false);
    setSelected(null);
    setDetail(null);
    setDetailError("");
    setResponsesOpen(false);
    void load();
    return () => {
      epoch.current++;
      detailEpoch.current++;
    };
  }, [load]);
  const openDetail = async (row: AdminSemesterContentRow) => {
    const request = ++detailEpoch.current;
    setSelected(row);
    setDetail(null);
    setDetailError("");
    setDetailBusy(true);
    setResponsesOpen(false);
    try {
      const page = await getAdminSemesterContent({
        semesterId,
        contentType,
        itemId: row.id,
        ...(parentId ? { parentId } : {}),
      });
      if (request !== detailEpoch.current) return;
      if (!page.detail) throw new Error("Missing archive detail");
      setDetail(page.detail);
    } catch {
      if (request === detailEpoch.current)
        setDetailError("자료 내용을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (request === detailEpoch.current) setDetailBusy(false);
    }
  };
  if (selected)
    return (
      <section className="min-w-0 space-y-4">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            detailEpoch.current++;
            setSelected(null);
            setDetail(null);
            setResponsesOpen(false);
          }}
        >
          목록으로 돌아가기
        </button>
        <h3 className="text-lg font-bold break-words">{selected.title}</h3>
        {detailBusy && (
          <PageDataLoading message="자료 내용을 불러오는 중입니다." />
        )}
        {detailError && (
          <div role="alert">
            <p className="text-red-700">{detailError}</p>
            <button
              type="button"
              className={`${buttonClass} mt-3`}
              onClick={() => void openDetail(selected)}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {detail && (
          <ContentDetails
            contentType={contentType}
            detail={detail}
            semesterId={semesterId}
          />
        )}
        {detail && contentType === "think_cloud_sessions" && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <button
              type="button"
              className={buttonClass}
              aria-expanded={responsesOpen}
              onClick={() => setResponsesOpen((value) => !value)}
            >
              {responsesOpen ? "학생 응답 닫기" : "학생 응답 보기"}
            </button>
            {responsesOpen && (
              <ContentList
                key={`${semesterId}:${selected.id}:${uid}`}
                semesterId={semesterId}
                contentType="think_cloud_responses"
                parentId={selected.id}
              />
            )}
          </div>
        )}
      </section>
    );
  return (
    <section className="min-w-0 space-y-4">
      {busy && (
        <PageDataLoading message="지난 학기 자료를 불러오는 중입니다." />
      )}
      {error && (
        <div role="alert">
          <p className="text-red-700">{error}</p>
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            disabled={busy}
            onClick={() => void load(cursor)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {loaded && (
        <>
          <p className="text-sm text-gray-600">
            불러온 자료 {rows.length.toLocaleString("ko-KR")}건 · 읽기 전용
          </p>
          {!rows.length ? (
            <p className="text-gray-600">이 학기에 저장된 자료가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full py-4 text-left hover:bg-gray-50"
                    onClick={() => void openDetail(row)}
                  >
                    <span className="block font-bold text-blue-800 break-words">
                      {row.title || "제목 없는 자료"}
                    </span>
                    {row.subtitle && (
                      <span className="mt-1 block text-sm text-gray-600 whitespace-pre-wrap break-words">
                        {row.subtitle}
                      </span>
                    )}
                    <span className="mt-1 block text-sm text-gray-600">
                      {statusLabel(row.status || "")} · 내용 보기
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void load(cursor)}
            >
              다음 자료 더 보기
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function SettingsArchiveContent({
  semesterId,
  group,
}: {
  semesterId: string;
  group: ArchiveContentGroup;
}) {
  const { currentUser } = useAuth();
  const options = contentKinds[group];
  const [selectedType, setSelectedType] = useState<AdminSemesterContentType>(
    options[0].type,
  );
  const contentType = options.some((option) => option.type === selectedType)
    ? selectedType
    : options[0].type;
  return (
    <div className="space-y-4 min-w-0">
      {options.length > 1 && (
        <label className="block text-sm font-bold text-gray-800">
          자료 유형
          <select
            className={`${fieldClass} mt-2`}
            value={contentType}
            onChange={(event) =>
              setSelectedType(event.target.value as AdminSemesterContentType)
            }
          >
            {options.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <ContentList
        key={`${semesterId}:${contentType}:${currentUser?.uid || ""}`}
        semesterId={semesterId}
        contentType={contentType}
      />
    </div>
  );
}
