import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LoadingOverlay } from "../../components/common/LoadingState";
import { useAppToast } from "../../components/common/AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import {
  approveHistoryDictionaryTermForRequests,
  deleteStudentHistoryDictionaryWordByTeacher,
  normalizeHistoryDictionaryWord,
  saveHistoryDictionaryTerm,
  subscribeTeacherHistoryDictionaryRequests,
  subscribeTeacherHistoryDictionaryTerms,
} from "../../lib/historyDictionary";
import type {
  HistoryDictionaryRequest,
  HistoryDictionaryTerm,
} from "../../types";

const OPEN_REQUEST_STATUSES = new Set(["requested", "needs_approval"]);
const INITIAL_FILTERS = [
  "전체",
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const HANGUL_INITIALS = INITIAL_FILTERS.slice(1);

type ActiveDictionaryPanel = "terms" | "requests";

const timestampLabel = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const statusLabel = (status: HistoryDictionaryRequest["status"]) => {
  if (status === "needs_approval") return "기존 풀이 승인 필요";
  if (status === "resolved") return "처리 완료";
  if (status === "rejected") return "보류";
  return "새 풀이 필요";
};

const getTimestampMs = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  return date?.getTime() || 0;
};

const getWordInitial = (value: string) => {
  const first = String(value || "")
    .trim()
    .charAt(0);
  if (!first) return "";
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return HANGUL_INITIALS[Math.floor((code - 0xac00) / 588)] || "";
  }
  return first.toUpperCase();
};

const normalizeTag = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

const ManageHistoryDictionary: React.FC = () => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState<HistoryDictionaryRequest[]>([]);
  const [terms, setTerms] = useState<HistoryDictionaryTerm[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [studentLevel, setStudentLevel] = useState("중학생 수준");
  const [relatedUnitId, setRelatedUnitId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [termSearch, setTermSearch] = useState("");
  const [activePanel, setActivePanel] =
    useState<ActiveDictionaryPanel>("terms");
  const [activeInitial, setActiveInitial] = useState("전체");

  useEffect(() => {
    const unsubscribeRequests =
      subscribeTeacherHistoryDictionaryRequests(setRequests);
    const unsubscribeTerms = subscribeTeacherHistoryDictionaryTerms(setTerms);
    return () => {
      unsubscribeRequests();
      unsubscribeTerms();
    };
  }, []);

  useEffect(() => {
    const panel = searchParams.get("panel");
    const requestId = searchParams.get("requestId");
    if (panel === "requests") {
      setActivePanel("requests");
      setSelectedTermId("");
    }
    if (requestId) {
      setActivePanel("requests");
      setSelectedTermId("");
      setSelectedRequestId(requestId);
    }
  }, [searchParams]);

  const openRequests = useMemo(
    () =>
      requests.filter((item) =>
        OPEN_REQUEST_STATUSES.has(String(item.status || "")),
      ),
    [requests],
  );

  const visibleRequests = useMemo(() => {
    const keyword = requestSearch.trim().toLowerCase();
    return openRequests
      .filter((item) => {
        if (!keyword) return true;
        return (
          item.word.toLowerCase().includes(keyword) ||
          (item.studentName || "").toLowerCase().includes(keyword) ||
          (item.memo || "").toLowerCase().includes(keyword)
        );
      })
      .sort(
        (a, b) =>
          getTimestampMs(b.updatedAt || b.createdAt) -
          getTimestampMs(a.updatedAt || a.createdAt),
      );
  }, [openRequests, requestSearch]);

  const visibleTerms = useMemo(() => {
    const keyword = termSearch.trim().toLowerCase();
    return [...terms]
      .filter((item) => {
        const matchesInitial =
          activeInitial === "전체" ||
          getWordInitial(item.word) === activeInitial;
        const matchesSearch =
          !keyword ||
          item.word.toLowerCase().includes(keyword) ||
          (item.definition || "").toLowerCase().includes(keyword) ||
          (item.studentLevel || "").toLowerCase().includes(keyword) ||
          (item.tags || []).some((tag) => tag.toLowerCase().includes(keyword));
        return matchesInitial && matchesSearch;
      })
      .sort((a, b) => a.word.localeCompare(b.word, "ko-KR"));
  }, [activeInitial, termSearch, terms]);

  const initialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    terms.forEach((item) => {
      const initial = getWordInitial(item.word);
      counts.set(initial, (counts.get(initial) || 0) + 1);
    });
    return counts;
  }, [terms]);

  const groupedVisibleTerms = useMemo(() => {
    const groups = new Map<string, HistoryDictionaryTerm[]>();
    visibleTerms.forEach((item) => {
      const initial = getWordInitial(item.word) || "기타";
      groups.set(initial, [...(groups.get(initial) || []), item]);
    });
    return Array.from(groups.entries());
  }, [visibleTerms]);

  const selectedRequest =
    (selectedRequestId
      ? openRequests.find((item) => item.id === selectedRequestId)
      : null) ||
    (activePanel === "requests" && !selectedTermId ? openRequests[0] : null) ||
    requests.find((item) => item.id === selectedRequestId) ||
    null;

  const selectedTerm = terms.find((item) => item.id === selectedTermId) || null;
  const normalizedEditorWord = normalizeHistoryDictionaryWord(word);
  const matchingTerm = useMemo(() => {
    const target = selectedRequest?.normalizedWord || normalizedEditorWord;
    if (!target) return null;
    return (
      terms.find(
        (item) =>
          item.normalizedWord === target &&
          item.status === "published" &&
          item.definition,
      ) || null
    );
  }, [normalizedEditorWord, selectedRequest?.normalizedWord, terms]);
  const sameWordOpenCount = selectedRequest
    ? openRequests.filter(
        (item) => item.normalizedWord === selectedRequest.normalizedWord,
      ).length
    : 0;

  useEffect(() => {
    if (!selectedRequest) return;
    setSelectedRequestId(selectedRequest.id);
    setSelectedTermId("");
    setWord(selectedRequest.word);
    const term = terms.find(
      (item) =>
        item.normalizedWord === selectedRequest.normalizedWord &&
        item.status === "published",
    );
    setDefinition(term?.definition || "");
    setStudentLevel(term?.studentLevel || "중학생 수준");
    setRelatedUnitId(term?.relatedUnitId || "");
    setTags(term?.tags || []);
    setTagInput("");
  }, [selectedRequest?.id, terms]);

  useEffect(() => {
    if (!selectedTerm) return;
    setWord(selectedTerm.word);
    setDefinition(selectedTerm.definition || "");
    setStudentLevel(selectedTerm.studentLevel || "중학생 수준");
    setRelatedUnitId(selectedTerm.relatedUnitId || "");
    setTags(selectedTerm.tags || []);
    setTagInput("");
  }, [selectedTerm]);

  const handleSelectRequest = (requestId: string) => {
    setActivePanel("requests");
    setSelectedRequestId(requestId);
    setSelectedTermId("");
    setSearchParams({ panel: "requests", requestId });
  };

  const handleSelectTerm = (term: HistoryDictionaryTerm) => {
    setActivePanel("terms");
    setSelectedTermId(term.id);
    setSelectedRequestId("");
    setSearchParams({});
  };

  const handleNewTerm = () => {
    setActivePanel("terms");
    setSelectedRequestId("");
    setSelectedTermId("__new__");
    setSearchParams({});
    setWord("");
    setDefinition("");
    setStudentLevel("중학생 수준");
    setRelatedUnitId("");
    setTags([]);
    setTagInput("");
  };

  const handleAddTag = () => {
    const nextTag = normalizeTag(tagInput);
    if (!nextTag) return;
    setTags((prev) => {
      if (prev.some((item) => item.toLowerCase() === nextTag.toLowerCase())) {
        return prev;
      }
      return [...prev, nextTag].slice(0, 12);
    });
    setTagInput("");
  };

  const handleRemoveTag = (target: string) => {
    setTags((prev) => prev.filter((item) => item !== target));
  };

  const handleSaveTerm = async () => {
    if (!word.trim() || definition.trim().length < 5 || busyMessage) return;
    setBusyMessage(
      "역사 사전 풀이를 저장하고 요청 학생에게 배포하는 중입니다.",
    );
    try {
      await saveHistoryDictionaryTerm(config, {
        word,
        definition,
        studentLevel,
        relatedUnitId,
        tags,
      });
      showToast({
        tone: "success",
        title: "역사 사전에 등록했습니다.",
        message: "같은 단어를 요청한 학생 단어장에 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save history dictionary term:", error);
      showToast({
        tone: "error",
        title: "역사 사전 저장에 실패했습니다.",
        message: "입력 내용을 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  const handleApproveExisting = async (requestId?: string) => {
    if (!matchingTerm || busyMessage) return;
    setBusyMessage("기존 뜻풀이를 승인하고 학생 단어장에 반영하는 중입니다.");
    try {
      await approveHistoryDictionaryTermForRequests(config, {
        termId: matchingTerm.id,
        requestId,
      });
      showToast({
        tone: "success",
        title: "뜻풀이를 승인했습니다.",
        message: requestId
          ? "선택한 요청 학생에게 단어장을 배포했습니다."
          : "같은 단어의 대기 요청을 함께 처리했습니다.",
      });
    } catch (error) {
      console.error("Failed to approve history dictionary term:", error);
      showToast({
        tone: "error",
        title: "뜻풀이 승인에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  const handleRejectRequestWord = async () => {
    if (!selectedRequest || busyMessage) return;
    const confirmed = window.confirm(
      `"${selectedRequest.word}" 요청 단어를 삭제할까요?\n부적절하거나 내용이 부족한 단어라면 학생 단어장에서 삭제되고, 지급된 역사 사전 위스가 있으면 함께 회수됩니다.`,
    );
    if (!confirmed) return;
    setBusyMessage("요청 단어를 삭제하고 지급된 위스를 확인하는 중입니다.");
    try {
      const result = await deleteStudentHistoryDictionaryWordByTeacher(config, {
        uid: selectedRequest.uid,
        requestId: selectedRequest.id,
        termId: selectedRequest.matchedTermId || selectedRequest.resolvedTermId,
        word: selectedRequest.word,
        normalizedWord: selectedRequest.normalizedWord,
        reason: "teacher_rejected_history_dictionary_word",
      });
      showToast({
        tone: "success",
        title: "요청 단어를 삭제했습니다.",
        message: result.reward?.reclaimed
          ? `지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
          : "요청을 반려하고 학생 단어장 항목을 정리했습니다.",
      });
      setSelectedRequestId("");
      setWord("");
      setDefinition("");
      setStudentLevel("중학생 수준");
      setRelatedUnitId("");
      setTags([]);
      setTagInput("");
    } catch (error) {
      console.error("Failed to reject history dictionary request:", error);
      showToast({
        tone: "error",
        title: "요청 단어 삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusyMessage("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-4 xl:grid-cols-[13rem_minmax(24rem,0.78fr)_minmax(0,1.2fr)]">
          <aside className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <nav
              className="divide-y divide-slate-200"
              aria-label="역사 사전 관리 메뉴"
            >
              {[
                {
                  id: "terms" as const,
                  label: "등록된 단어",
                  description: "등록 풀이 수정",
                },
                {
                  id: "requests" as const,
                  label: "학생 요청 단어",
                  description: "요청 풀이 작성",
                },
              ].map((item) => {
                const active = activePanel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePanel(item.id);
                      if (item.id === "terms") {
                        setSelectedRequestId("");
                        setSearchParams({});
                      } else {
                        setSelectedTermId("");
                        setSearchParams({ panel: "requests" });
                      }
                    }}
                    className={`relative block min-h-[3.75rem] w-full px-4 py-3 text-left transition ${
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute inset-y-0 left-0 w-1 bg-blue-600"
                        aria-hidden="true"
                      />
                    )}
                    <span className="block text-sm font-extrabold">
                      {item.label}
                    </span>
                    <span
                      className={`mt-1 block text-xs font-bold ${
                        active ? "text-blue-600" : "text-slate-500"
                      }`}
                    >
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {activePanel === "terms" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-slate-950">
                  등록된 단어
                </h2>
                <button
                  type="button"
                  onClick={handleNewTerm}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  <i className="fas fa-plus text-[11px]" aria-hidden="true"></i>
                  새 풀이
                </button>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[4.75rem_minmax(0,1fr)]">
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
                  {INITIAL_FILTERS.map((initial) => {
                    const active = activeInitial === initial;
                    const count =
                      initial === "전체"
                        ? terms.length
                        : initialCounts.get(initial) || 0;
                    return (
                      <button
                        key={initial}
                        type="button"
                        onClick={() => setActiveInitial(initial)}
                        className={`flex h-11 items-center justify-center rounded-lg border text-sm font-extrabold transition ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                        }`}
                        title={`${initial} ${count}개`}
                      >
                        {initial}
                      </button>
                    );
                  })}
                </div>

                <div className="min-w-0">
                  <label className="relative block">
                    <span className="sr-only">등록 풀이 검색</span>
                    <i
                      className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                      aria-hidden="true"
                    ></i>
                    <input
                      type="search"
                      value={termSearch}
                      onChange={(event) => setTermSearch(event.target.value)}
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="단어, 뜻풀이 검색"
                    />
                  </label>

                  <div className="mt-4 text-xs font-bold text-slate-500">
                    등록된 단어 {terms.length}개
                  </div>

                  <div className="mt-4 max-h-[calc(100vh-22rem)] min-h-[26rem] overflow-y-auto pr-1">
                    {!visibleTerms.length && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                        표시할 단어가 없습니다.
                      </div>
                    )}
                    <div className="space-y-3">
                      {groupedVisibleTerms.map(([initial, items]) => (
                        <section key={initial}>
                          <div className="mb-2 px-2 text-sm font-extrabold text-slate-900">
                            {initial}
                          </div>
                          <div className="space-y-2">
                            {items.map((item) => {
                              const active = selectedTerm?.id === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleSelectTerm(item)}
                                  className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                                    active
                                      ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span
                                      className={`min-w-0 truncate text-sm font-extrabold ${
                                        active
                                          ? "text-blue-700"
                                          : "text-slate-900"
                                      }`}
                                    >
                                      {item.word}
                                    </span>
                                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                                      {item.studentLevel || "학생용"}
                                    </span>
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                    {item.definition}
                                  </p>
                                  {!!item.tags?.length && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {item.tags.slice(0, 4).map((tag) => (
                                        <span
                                          key={`${item.id}-${tag}`}
                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {item.tags.length > 4 && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">
                                          +{item.tags.length - 4}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="mt-2 text-[11px] font-bold text-slate-400">
                                    {timestampLabel(
                                      item.updatedAt ||
                                        item.publishedAt ||
                                        item.createdAt,
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          ) : (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-950">
                    학생 요청 단어
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    요청 맥락을 확인한 뒤 풀이를 작성해 배포합니다.
                  </p>
                </div>
              </div>

              <label className="relative mt-5 block">
                <span className="sr-only">요청 검색</span>
                <i
                  className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                  aria-hidden="true"
                ></i>
                <input
                  type="search"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="요청 단어, 학생, 메모 검색"
                />
              </label>

              <div className="mt-4 max-h-[calc(100vh-18rem)] min-h-[26rem] overflow-y-auto pr-1">
                {!visibleRequests.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    대기 중인 요청이 없습니다.
                  </div>
                )}
                <div className="space-y-2">
                  {visibleRequests.map((item) => {
                    const active = selectedRequest?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectRequest(item.id)}
                        className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                          active
                            ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                            : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`min-w-0 truncate text-sm font-extrabold ${
                              active ? "text-blue-700" : "text-slate-900"
                            }`}
                          >
                            {item.word}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                              item.status === "needs_approval"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {item.grade}학년 {item.class}반 {item.number}번 ·{" "}
                          {item.studentName || "학생"}
                        </div>
                        {item.memo && (
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                            {item.memo}
                          </div>
                        )}
                        <div className="mt-2 text-[11px] font-bold text-slate-400">
                          {timestampLabel(item.updatedAt || item.createdAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          )}

          <main className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                    {word.trim() || "새 풀이"}
                  </h2>
                  {selectedRequest && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700">
                      요청 처리
                    </span>
                  )}
                  {selectedTerm && (
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                      등록됨
                    </span>
                  )}
                </div>
              </div>
              {selectedTerm && (
                <div className="text-xs font-semibold text-slate-400">
                  마지막 수정{" "}
                  {timestampLabel(
                    selectedTerm.updatedAt ||
                      selectedTerm.publishedAt ||
                      selectedTerm.createdAt,
                  )}
                </div>
              )}
            </div>

            {selectedRequest && (
              <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      학생 요청
                    </div>
                    <div className="mt-1 text-sm font-extrabold text-slate-900">
                      {selectedRequest.grade}학년 {selectedRequest.class}반{" "}
                      {selectedRequest.number}번 ·{" "}
                      {selectedRequest.studentName || "학생"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 shadow-sm">
                      같은 단어 대기 {sameWordOpenCount}건
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRejectRequestWord()}
                      disabled={Boolean(busyMessage)}
                      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 text-xs font-extrabold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <i
                        className="fas fa-trash-can text-[11px]"
                        aria-hidden="true"
                      ></i>
                      요청 삭제
                    </button>
                  </div>
                </div>
                {selectedRequest.memo && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {selectedRequest.memo}
                  </p>
                )}
              </section>
            )}

            {selectedRequest && matchingTerm && (
              <section className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                    <i
                      className="fas fa-circle-info text-xs"
                      aria-hidden="true"
                    ></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold text-blue-900">
                      이미 등록된 뜻풀이가 있습니다.
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-900">
                      {matchingTerm.definition}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleApproveExisting(selectedRequest.id)
                        }
                        disabled={Boolean(busyMessage)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <i className="fas fa-check text-[11px]"></i>이 요청만
                        승인
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleApproveExisting()}
                        disabled={Boolean(busyMessage)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-extrabold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        같은 단어 모두 승인
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="mt-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
                <label className="block">
                  <span className="text-sm font-extrabold text-slate-800">
                    단어
                  </span>
                  <input
                    type="text"
                    value={word}
                    onChange={(event) => setWord(event.target.value)}
                    maxLength={40}
                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-extrabold text-slate-800">
                    풀이 수준
                  </span>
                  <input
                    type="text"
                    value={studentLevel}
                    onChange={(event) => setStudentLevel(event.target.value)}
                    maxLength={80}
                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-extrabold text-slate-800">
                  학생용 역사 풀이
                </span>
                <textarea
                  value={definition}
                  onChange={(event) => setDefinition(event.target.value)}
                  maxLength={1200}
                  className="mt-2 min-h-[14rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="학생 수준과 현재 수업 맥락에 맞게 풀이를 적어 주세요."
                />
                <span className="mt-2 block text-right text-xs font-semibold text-slate-400">
                  {definition.length} / 1200
                </span>
              </label>

              <section>
                <div className="mb-2 text-sm font-extrabold text-slate-800">
                  관련 단원 / 태그
                </div>
                <div className="flex flex-wrap gap-2">
                  {relatedUnitId && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                      {relatedUnitId}
                      <button
                        type="button"
                        onClick={() => setRelatedUnitId("")}
                        className="text-slate-400 transition hover:text-slate-700"
                        aria-label={`${relatedUnitId} 태그 제거`}
                      >
                        <i className="fas fa-times text-[10px]"></i>
                      </button>
                    </span>
                  )}
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-slate-400 transition hover:text-slate-700"
                        aria-label={`${tag} 태그 제거`}
                      >
                        <i className="fas fa-times text-[10px]"></i>
                      </button>
                    </span>
                  ))}
                  {!relatedUnitId && !tags.length && (
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-400">
                      태그 없음
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.25rem]">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      handleAddTag();
                    }}
                    maxLength={24}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    placeholder="태그 입력 후 Enter"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    disabled={!normalizeTag(tagInput) || tags.length >= 12}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <i className="fas fa-plus text-xs" aria-hidden="true"></i>
                    태그 추가
                  </button>
                </div>
                <input
                  type="text"
                  value={relatedUnitId}
                  onChange={(event) => setRelatedUnitId(event.target.value)}
                  maxLength={120}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="관련 단원 ID 또는 단원명"
                />
              </section>

              <section>
                <div className="mb-2 text-sm font-extrabold text-slate-800">
                  처리 범위
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                    학생용 풀이
                  </span>
                  {selectedRequest && (
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                      요청 {sameWordOpenCount}건 연결
                    </span>
                  )}
                  {selectedTerm?.status && (
                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                      {selectedTerm.status === "published"
                        ? "공개됨"
                        : selectedTerm.status}
                    </span>
                  )}
                  {tags.map((tag) => (
                    <span
                      key={`scope-${tag}`}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            </section>

            <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={handleNewTerm}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
              >
                취소
              </button>
              {selectedRequest && matchingTerm && (
                <button
                  type="button"
                  onClick={() => void handleApproveExisting()}
                  disabled={Boolean(busyMessage)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-5 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <i className="fas fa-check text-xs" aria-hidden="true"></i>
                  기존 풀이 승인
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSaveTerm()}
                disabled={
                  Boolean(busyMessage) ||
                  !word.trim() ||
                  definition.trim().length < 5
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <i
                  className="fas fa-floppy-disk text-xs"
                  aria-hidden="true"
                ></i>
                풀이 저장 및 배포
              </button>
            </div>
          </main>
        </div>
      </div>

      {busyMessage && <LoadingOverlay message={busyMessage} />}
    </div>
  );
};

export default ManageHistoryDictionary;
