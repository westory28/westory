import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";

type SemesterScope = { year: string; semester: string };
type ArchiveResource = "lessons" | "quiz_questions" | "calendar" | "notices";
type ArchiveEntry = { id: string; data: DocumentData };

const RESOURCES: { value: ArchiveResource; label: string }[] = [
  { value: "lessons", label: "수업자료" },
  { value: "quiz_questions", label: "문제은행" },
  { value: "calendar", label: "학사 일정" },
  { value: "notices", label: "공지" },
];
const PAGE_SIZE = 30;
const controlClass =
  "w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60";

const semesterKey = (scope: SemesterScope) => `${scope.year}-${scope.semester}`;
const semesterLabel = (scope: SemesterScope) =>
  `${scope.year}학년도 ${scope.semester}학기`;
const semesterOrder = (scope: SemesterScope) =>
  Number(scope.year) * 2 + Number(scope.semester);
const parseScope = (value: unknown): SemesterScope | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const year = String(source.year || "").trim();
  const semester = String(source.semester || "").trim();
  return /^\d{4}$/.test(year) && ["1", "2"].includes(semester)
    ? { year, semester }
    : null;
};
const textValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

// Archive HTML is converted to inert text. Never mount historical markup or
// reuse an editor whose effects could save against the active semester.
const plainText = (value: unknown) => {
  const source = textValue(value);
  if (!source || !/<\/?[a-z][\s\S]*>/i.test(source)) return source;
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed
    .querySelectorAll("script, style, iframe, object, embed, template")
    .forEach((element) => element.remove());
  parsed.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
  parsed
    .querySelectorAll("p, div, li, h1, h2, h3, h4, tr")
    .forEach((element) => element.append("\n"));
  return (parsed.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};
const safeAttachmentUrl = (value: unknown) => {
  try {
    const url = new URL(textValue(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};
const safeImageUrl = (value: unknown) => {
  const source = textValue(value);
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(
    source,
  )
    ? source
    : safeAttachmentUrl(source);
};
const dateLabel = (value: unknown) => {
  if (typeof value === "string") return value.replace("T", " ").slice(0, 16);
  const seconds =
    value && typeof value === "object"
      ? Number((value as { seconds?: unknown }).seconds)
      : NaN;
  if (!Number.isFinite(seconds)) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(seconds * 1000));
};
const targetLabel = (data: DocumentData) =>
  data.targetType === "class" && textValue(data.targetClass)
    ? `${textValue(data.targetClass)}반`
    : "전체";
const categoryLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    exam: "정기 시험",
    performance: "수행평가",
    event: "학교 행사",
    diagnosis: "진단평가",
    formative: "형성평가",
    holiday: "공휴일",
    prep: "준비",
    dday: "D-Day",
  };
  return labels[textValue(value)] || "일반";
};
const questionTypeLabel = (value: unknown) => {
  const labels: Record<string, string> = {
    choice: "객관식",
    ox: "OX",
    word: "단답형",
    order: "순서형",
    matching: "연결형",
  };
  return labels[textValue(value)] || "문항";
};

const entryTitle = (resource: ArchiveResource, data: DocumentData) => {
  if (resource === "quiz_questions")
    return plainText(data.question) || "질문 내용 없음";
  if (resource === "notices")
    return (
      plainText(data.title) ||
      plainText(data.content).split("\n")[0] ||
      `${categoryLabel(data.category)} 알림장`
    );
  return plainText(data.title) || "제목 없음";
};
const entryMeta = (resource: ArchiveResource, data: DocumentData) => {
  if (resource === "quiz_questions")
    return [
      questionTypeLabel(data.type),
      dateLabel(data.updatedAt || data.createdAt),
    ]
      .filter(Boolean)
      .join(" · ");
  if (resource === "calendar")
    return [
      dateLabel(data.start),
      categoryLabel(data.eventType),
      targetLabel(data),
    ]
      .filter(Boolean)
      .join(" · ");
  if (resource === "notices")
    return [dateLabel(data.publishAt || data.createdAt), targetLabel(data)]
      .filter(Boolean)
      .join(" · ");
  return [
    dateLabel(data.updatedAt),
    data.isVisibleToStudents === false ? "학생 비공개" : "학생 공개",
    textValue(data.pdfName),
  ]
    .filter(Boolean)
    .join(" · ");
};

const TextSection: React.FC<{ label: string; value: unknown }> = ({
  label,
  value,
}) => {
  const content = plainText(value);
  if (!content) return null;
  return (
    <div>
      <h5 className="mb-2 text-xs font-bold text-gray-500">{label}</h5>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
        {content}
      </p>
    </div>
  );
};

const ArchiveImage: React.FC<{ value: unknown; alt: string }> = ({
  value,
  alt,
}) => {
  const url = safeImageUrl(value);
  const originalUrl = safeAttachmentUrl(value);
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  return (
    <div>
      {!failed && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mb-2 h-auto max-w-full rounded-lg object-contain"
          onError={() => setFailed(true)}
        />
      )}
      {originalUrl ? (
        <a
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block py-2 text-sm font-bold text-blue-700 underline"
        >
          {failed ? `${alt} 직접 열기` : `${alt} 원본 열기`} (새 창)
        </a>
      ) : failed ? (
        <p className="text-sm text-gray-500">이미지를 표시하지 못했습니다.</p>
      ) : null}
    </div>
  );
};

const ArchiveEntryDetail: React.FC<{
  resource: ArchiveResource;
  data: DocumentData;
}> = ({ resource, data }) => {
  if (resource === "lessons") {
    const pdfUrl = safeAttachmentUrl(data.pdfUrl);
    const videoUrl = safeAttachmentUrl(data.videoUrl);
    return (
      <div className="space-y-4">
        <TextSection label="수업 본문" value={data.contentHtml} />
        {!plainText(data.contentHtml) && (
          <p className="text-sm text-gray-500">
            저장된 텍스트 본문이 없습니다.
          </p>
        )}
        {(pdfUrl || videoUrl) && (
          <div className="flex flex-wrap gap-4">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all py-2 text-sm font-bold text-blue-700 underline"
              >
                {textValue(data.pdfName) || "첨부 PDF"} 열기 (새 창)
              </a>
            )}
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2 text-sm font-bold text-blue-700 underline"
              >
                수업 영상 열기 (새 창)
              </a>
            )}
          </div>
        )}
        <p className="text-xs leading-5 text-gray-500">
          본문은 텍스트로 표시합니다. PDF와 영상은 이 학기 자료에 저장된 첨부를
          엽니다.
        </p>
      </div>
    );
  }
  if (resource === "quiz_questions") {
    const options = Array.isArray(data.options) ? data.options : [];
    const optionImages = Array.isArray(data.choiceOptionImages)
      ? data.choiceOptionImages
      : [];
    const pairs = Array.isArray(data.matchingPairs) ? data.matchingPairs : [];
    return (
      <div className="space-y-4">
        <TextSection label="질문" value={data.question} />
        <TextSection label="제시문" value={data.passage} />
        <ArchiveImage value={data.image} alt="문항 이미지" />
        {Math.max(options.length, optionImages.length) > 0 && (
          <div>
            <h5 className="mb-2 text-xs font-bold text-gray-500">선택지</h5>
            <ol className="space-y-3">
              {Array.from(
                { length: Math.max(options.length, optionImages.length) },
                (_, index) => (
                  <li
                    key={index}
                    className="flex gap-3 text-sm leading-6 text-gray-800"
                  >
                    <span className="shrink-0 font-bold">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap break-words">
                        {plainText(options[index])}
                      </p>
                      <ArchiveImage
                        value={optionImages[index]}
                        alt={`${index + 1}번 선택지 이미지`}
                      />
                    </div>
                  </li>
                ),
              )}
            </ol>
          </div>
        )}
        {pairs.length > 0 && (
          <TextSection
            label="연결 정답"
            value={pairs
              .map(
                (pair) =>
                  `${plainText(pair?.left)} → ${plainText(pair?.right)}`,
              )
              .join("\n")}
          />
        )}
        <TextSection
          label="정답"
          value={
            Array.isArray(data.answer)
              ? data.answer
                  .map(plainText)
                  .join(data.type === "order" ? " → " : ", ")
              : data.answer
          }
        />
        <TextSection label="해설" value={data.explanation} />
        <TextSection label="힌트" value={data.hint} />
      </div>
    );
  }
  if (resource === "calendar") {
    return (
      <div className="space-y-4">
        <TextSection
          label="기간"
          value={[dateLabel(data.start), dateLabel(data.end)]
            .filter((item, index, all) => item && all.indexOf(item) === index)
            .join(" ~ ")}
        />
        <TextSection
          label="교시"
          value={
            data.allDay
              ? "종일"
              : [
                  textValue(data.startPeriod || data.period),
                  textValue(data.endPeriod),
                ]
                  .filter(
                    (item, index, all) => item && all.indexOf(item) === index,
                  )
                  .join(" ~ ")
          }
        />
        <TextSection label="상세 내용" value={data.description} />
        {!plainText(data.description) && (
          <p className="text-sm text-gray-500">추가 설명이 없습니다.</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <TextSection label="공지 내용" value={data.content} />
      <TextSection label="안내 날짜" value={dateLabel(data.targetDate)} />
      <ArchiveImage value={data.imageUrl} alt="알림장 이미지" />
      {!plainText(data.content) && !safeImageUrl(data.imageUrl) && (
        <p className="text-sm text-gray-500">
          저장된 본문이나 이미지가 없습니다.
        </p>
      )}
    </div>
  );
};

const ArchiveResourceList: React.FC<{
  scope: SemesterScope;
  resource: ArchiveResource;
}> = ({ scope, resource }) => {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);

  const loadPage = async (append: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const constraints: QueryConstraint[] = [
        orderBy(documentId()),
        limit(PAGE_SIZE + 1),
      ];
      if (append && cursorRef.current)
        constraints.push(startAfter(cursorRef.current));
      const snapshot = await getDocs(
        query(
          collection(db, getSemesterCollectionPath(scope, resource)),
          ...constraints,
        ),
      );
      if (!mountedRef.current || requestId !== requestRef.current) return;
      const page = snapshot.docs.slice(0, PAGE_SIZE);
      cursorRef.current = page[page.length - 1] || cursorRef.current;
      setEntries((previous) => [
        ...(append ? previous : []),
        ...page.map((item) => ({ id: item.id, data: item.data() })),
      ]);
      setHasMore(snapshot.docs.length > PAGE_SIZE);
    } catch (caught) {
      if (!mountedRef.current || requestId !== requestRef.current) return;
      console.error("Failed to read semester archive", caught);
      const code = String((caught as { code?: string })?.code || "");
      setError(
        code.includes("permission-denied")
          ? "이 학기 자료를 조회할 권한을 확인하지 못했습니다. 관리자 계정으로 로그인했는지 확인해 주세요."
          : "자료를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    inFlightRef.current = false;
    void loadPage(false);
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const resourceLabel = RESOURCES.find(
    (item) => item.value === resource,
  )!.label;
  return (
    <section
      aria-label={`${semesterLabel(scope)} ${resourceLabel}`}
      aria-busy={loading}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-gray-900">{resourceLabel}</h4>
        <span className="text-xs text-gray-500">{entries.length}건 불러옴</span>
      </div>
      <div className="divide-y divide-gray-200 border-y border-gray-200">
        {entries.map((entry) => (
          <details key={entry.id} open={openedId === entry.id}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setOpenedId((previous) =>
                  previous === entry.id ? null : entry.id,
                );
              }}
              className="flex min-h-10 cursor-pointer list-none items-center gap-3 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden"
            >
              <div className="min-w-0 flex-1">
                <span className="block break-words text-sm font-bold leading-6 text-gray-800">
                  {entryTitle(resource, entry.data)}
                </span>
                <span className="mt-1 block break-words text-xs leading-5 text-gray-500">
                  {entryMeta(resource, entry.data)}
                </span>
              </div>
              <i
                aria-hidden="true"
                className={`fas ${openedId === entry.id ? "fa-chevron-up" : "fa-chevron-down"} shrink-0 text-xs text-gray-400`}
              />
            </summary>
            {openedId === entry.id && (
              <div className="pb-6">
                <ArchiveEntryDetail resource={resource} data={entry.data} />
              </div>
            )}
          </details>
        ))}
      </div>
      {loading && (
        <InlineLoading message={`${resourceLabel}를 불러오는 중입니다.`} />
      )}
      {!loading && !error && entries.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-sm font-bold text-gray-700">
            {semesterLabel(scope)}에 저장된 {resourceLabel} 내역이 없습니다.
          </p>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            학기가 지정되지 않은 공통·이전 방식 자료는 이 목록에 섞어 표시하지
            않습니다.
          </p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
        >
          {error}
        </p>
      )}
      {!loading && (error || hasMore) && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadPage(entries.length > 0)}
            className={secondaryButtonClass}
          >
            {error ? "다시 불러오기" : "30건 더 보기"}
          </button>
        </div>
      )}
    </section>
  );
};

const SettingsSemesterArchive: React.FC = () => {
  const { currentUser, config } = useAuth();
  const [catalog, setCatalog] = useState<{
    owner: string;
    active: SemesterScope;
    previous: SemesterScope[];
  } | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [resource, setResource] = useState<ArchiveResource>("lessons");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
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
        const active = parseScope(data);
        if (!active) throw new Error("운영 학기를 확인하지 못했습니다.");
        const registry = new Map<string, SemesterScope>();
        if (Array.isArray(data?.availableSemesters)) {
          data.availableSemesters.forEach((item: unknown) => {
            const scope = parseScope(item);
            if (scope && semesterOrder(scope) < semesterOrder(active))
              registry.set(semesterKey(scope), scope);
          });
        }
        const previous = [...registry.values()].sort(
          (left, right) => semesterOrder(right) - semesterOrder(left),
        );
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
    <div className="w-full min-w-0 max-w-3xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-6 border-b border-gray-100 pb-4">
        <h3 className="text-lg font-bold text-gray-900">이전 학기 조회</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          학기별로 보관된 수업자료와 운영 자료를 보기 전용으로 확인합니다.
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
              여기서 학기를 골라도 학생과 교사의 운영 학기는 바뀌지 않습니다.
            </p>
          </div>
          {visibleCatalog.previous.length === 0 ? (
            <p className="py-6 text-sm leading-6 text-gray-500">
              현재 운영 학기보다 이전으로 등록된 학기가 없습니다.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="archive-semester"
                    className="mb-2 block text-sm font-bold text-gray-700"
                  >
                    조회할 이전 학기
                  </label>
                  <select
                    id="archive-semester"
                    value={selectedKey}
                    onChange={(event) => setSelectedKey(event.target.value)}
                    className={controlClass}
                  >
                    {visibleCatalog.previous.map((item) => (
                      <option key={semesterKey(item)} value={semesterKey(item)}>
                        {semesterLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="archive-resource"
                    className="mb-2 block text-sm font-bold text-gray-700"
                  >
                    조회 자료
                  </label>
                  <select
                    id="archive-resource"
                    value={resource}
                    onChange={(event) =>
                      setResource(event.target.value as ArchiveResource)
                    }
                    className={controlClass}
                  >
                    {RESOURCES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selected && (
                <div>
                  <p
                    role="status"
                    className="mb-4 text-sm font-bold text-gray-900"
                  >
                    {semesterLabel(selected)} 자료 조회 중
                  </p>
                  <ArchiveResourceList
                    key={`${owner}:${selectedKey}:${resource}`}
                    scope={selected}
                    resource={resource}
                  />
                </div>
              )}
            </>
          )}
          <p className="border-t border-gray-100 pt-4 text-xs leading-5 text-gray-500">
            선택한 학기에 저장된 자료만 표시합니다. 학기가 지정되지 않은 공통
            자료와 학생별 성적·응시 기록은 포함하지 않습니다.
          </p>
        </div>
      )}
    </div>
  );
};

export default SettingsSemesterArchive;
