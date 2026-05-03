import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { useAppToast } from "../../../components/common/AppToastProvider";
import {
  deleteStudentHistoryDictionaryWord,
  loadPublishedHistoryDictionaryTerm,
  normalizeHistoryDictionaryWord,
  requestHistoryDictionaryTerm,
  saveStudentHistoryDictionaryEntry,
  saveStudentHistoryDictionaryWord,
  subscribeStudentHistoryDictionaryWords,
} from "../../../lib/historyDictionary";
import type {
  HistoryDictionaryTerm,
  StudentHistoryDictionaryWord,
} from "../../../types";

const ALL_INITIAL = "전체";
const NUMBER_INITIAL = "숫자";
const HANGUL_INITIALS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const BASE_INITIAL_BY_TENSE: Record<string, string> = {
  ㄲ: "ㄱ",
  ㄸ: "ㄷ",
  ㅃ: "ㅂ",
  ㅆ: "ㅅ",
  ㅉ: "ㅈ",
};
const INITIAL_FILTERS = [
  ALL_INITIAL,
  NUMBER_INITIAL,
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

const formatStatusLabel = (status: StudentHistoryDictionaryWord["status"]) =>
  status === "saved" ? "저장됨" : "요청 중";

const getWordInitial = (value: string) => {
  const first = String(value || "")
    .trim()
    .charAt(0);
  if (!first) return "";
  if (/^\d$/.test(first)) return NUMBER_INITIAL;
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const initial = HANGUL_INITIALS[Math.floor((code - 0xac00) / 588)] || "";
    return BASE_INITIAL_BY_TENSE[initial] || initial;
  }
  return first.toUpperCase();
};

const formatTimestamp = (value: unknown) => {
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

const getTimestampMs = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  return date?.getTime() || 0;
};

const HistoryDictionary: React.FC = () => {
  const { currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const wordListRef = useRef<HTMLDivElement>(null);
  const wordSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [words, setWords] = useState<StudentHistoryDictionaryWord[]>([]);
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [memo, setMemo] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [teacherTerm, setTeacherTerm] = useState<HistoryDictionaryTerm | null>(
    null,
  );
  const [teacherChecked, setTeacherChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeInitial, setActiveInitial] = useState(ALL_INITIAL);
  const [scrollActiveInitial, setScrollActiveInitial] = useState(ALL_INITIAL);
  const [sortMode, setSortMode] = useState<"alpha" | "recent">("alpha");
  const [selectedWordId, setSelectedWordId] = useState("");

  const currentWord = word.trim();
  const normalizedCurrentWord = normalizeHistoryDictionaryWord(currentWord);
  const selectedWord = useMemo(
    () =>
      words.find((item) => item.id === selectedWordId) ||
      words.find((item) => item.normalizedWord === normalizedCurrentWord) ||
      null,
    [normalizedCurrentWord, selectedWordId, words],
  );
  const hasRequestedCurrentWord = selectedWord?.status === "requested";
  const selectedUpdatedAt = formatTimestamp(
    selectedWord?.updatedAt || selectedWord?.createdAt,
  );

  const initialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    words.forEach((item) => {
      const initial = getWordInitial(item.word);
      counts.set(initial, (counts.get(initial) || 0) + 1);
    });
    return counts;
  }, [words]);

  const visibleWords = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = words.filter((item) => {
      const matchesInitial =
        activeInitial === ALL_INITIAL ||
        getWordInitial(item.word) === activeInitial;
      const matchesSearch =
        !normalizedSearch ||
        item.word.toLowerCase().includes(normalizedSearch) ||
        (item.definition || "").toLowerCase().includes(normalizedSearch);
      return matchesInitial && matchesSearch;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "recent") {
        return (
          getTimestampMs(b.updatedAt || b.createdAt) -
          getTimestampMs(a.updatedAt || a.createdAt)
        );
      }
      return a.word.localeCompare(b.word, "ko-KR");
    });
  }, [activeInitial, searchTerm, sortMode, words]);

  const groupedVisibleWords = useMemo(() => {
    const groups = new Map<string, StudentHistoryDictionaryWord[]>();
    visibleWords.forEach((item) => {
      const initial = getWordInitial(item.word) || "기타";
      groups.set(initial, [...(groups.get(initial) || []), item]);
    });
    return Array.from(groups.entries());
  }, [visibleWords]);
  const highlightedInitial =
    activeInitial === ALL_INITIAL && scrollActiveInitial !== ALL_INITIAL
      ? scrollActiveInitial
      : activeInitial;

  useEffect(() => {
    if (activeInitial !== ALL_INITIAL) return;
    setScrollActiveInitial(groupedVisibleWords[0]?.[0] || ALL_INITIAL);
  }, [activeInitial, groupedVisibleWords]);

  const handleInitialFilterClick = (initial: string) => {
    setActiveInitial(initial);
    setScrollActiveInitial(initial);
    wordListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleWordListScroll = useCallback(() => {
    if (activeInitial !== ALL_INITIAL) return;
    const container = wordListRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const sections = groupedVisibleWords
      .map(([initial]) => ({
        initial,
        element: wordSectionRefs.current[initial],
      }))
      .filter((item): item is { initial: string; element: HTMLElement } =>
        Boolean(item.element),
      );
    if (!sections.length) {
      setScrollActiveInitial(ALL_INITIAL);
      return;
    }

    let nextInitial = sections[0].initial;
    for (const section of sections) {
      const offset = section.element.getBoundingClientRect().top - containerTop;
      if (offset <= 16) {
        nextInitial = section.initial;
      } else {
        break;
      }
    }
    setScrollActiveInitial((prev) =>
      prev === nextInitial ? prev : nextInitial,
    );
  }, [activeInitial, groupedVisibleWords]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setWords([]);
      return undefined;
    }
    return subscribeStudentHistoryDictionaryWords(currentUser.uid, setWords);
  }, [currentUser?.uid]);

  useEffect(() => {
    setTeacherChecked(false);
    setTeacherTerm(null);
    setWarningAccepted(false);
    if (selectedWord?.definition) {
      setDefinition(selectedWord.definition);
    }
  }, [selectedWord?.definition, word]);

  useEffect(() => {
    if (selectedWordId || word.trim() || !visibleWords[0]) return;
    const firstWord = visibleWords[0];
    setSelectedWordId(firstWord.id);
    setWord(firstWord.word);
    setDefinition(firstWord.definition || "");
  }, [selectedWordId, visibleWords, word]);

  const handleSelectWord = (item: StudentHistoryDictionaryWord) => {
    setSelectedWordId(item.id);
    setWord(item.word);
    setDefinition(item.definition || "");
    setMemo("");
  };

  const handleNewEntry = () => {
    setSelectedWordId("");
    setWord("");
    setDefinition("");
    setMemo("");
    setTeacherTerm(null);
    setTeacherChecked(false);
    setWarningAccepted(false);
  };

  const handleSave = async () => {
    if (!currentWord || definition.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      const result = await saveStudentHistoryDictionaryEntry({
        config,
        word: currentWord,
        definition: definition.trim(),
      });
      showToast({
        tone: "success",
        title: "내 역사 사전에 저장했습니다.",
        message: result.reward?.awarded
          ? `"${currentWord}"을 저장하고 ${Number(result.reward.amount || 0)}위스를 받았습니다.`
          : `"${currentWord}"을 직접 정리한 단어로 저장했습니다.`,
      });
    } catch (error) {
      console.error("Failed to save student dictionary entry:", error);
      showToast({
        tone: "error",
        title: "단어 저장에 실패했습니다.",
        message: "단어와 뜻풀이를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedWord?.termId || busy) return;
    const confirmed = window.confirm(
      `"${selectedWord.word}" 단어를 내 역사 사전에서 삭제할까요?\n지급된 역사 사전 위스가 있으면 함께 회수됩니다.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await deleteStudentHistoryDictionaryWord(
        config,
        selectedWord.termId,
      );
      handleNewEntry();
      showToast({
        tone: "success",
        title: "단어를 삭제했습니다.",
        message: result.reward?.reclaimed
          ? `지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
          : "내 역사 사전에서 단어를 삭제했습니다.",
      });
    } catch (error) {
      console.error("Failed to delete student dictionary entry:", error);
      showToast({
        tone: "error",
        title: "단어 삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCheckTeacherTerm = async () => {
    if (!currentWord || busy) return;
    setBusy(true);
    try {
      const result = await loadPublishedHistoryDictionaryTerm(currentWord);
      setTeacherTerm(result);
      setTeacherChecked(true);
    } catch (error) {
      console.error("Failed to check teacher dictionary term:", error);
      setTeacherTerm(null);
      setTeacherChecked(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTeacherTerm = async () => {
    if (!teacherTerm || busy) return;
    setBusy(true);
    try {
      await saveStudentHistoryDictionaryWord(teacherTerm.id);
      setDefinition(teacherTerm.definition);
      showToast({
        tone: "success",
        title: "선생님 뜻풀이를 저장했습니다.",
        message: "내 역사 사전에 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save teacher dictionary term:", error);
      showToast({
        tone: "error",
        title: "선생님 뜻풀이 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRequest = async () => {
    if (!currentWord || !warningAccepted || busy) return;
    setBusy(true);
    try {
      const composedMemo = [
        memo.trim(),
        definition.trim() ? `학생이 정리한 뜻풀이: ${definition.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await requestHistoryDictionaryTerm(config, {
        word: currentWord,
        memo: composedMemo,
        warningAccepted,
      });
      setMemo("");
      setWarningAccepted(false);
      setRequestDialogOpen(false);
      showToast({
        tone: "success",
        title: "선생님께 요청을 보냈습니다.",
        message: "선생님이 승인하면 공식 뜻풀이가 내 단어장에 반영됩니다.",
      });
    } catch (error) {
      console.error("Failed to request teacher dictionary term:", error);
      showToast({
        tone: "error",
        title: "요청을 보내지 못했습니다.",
        message: "단어를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  };

  const openRequestDialog = () => {
    if (!currentWord || hasRequestedCurrentWord || busy) return;
    setWarningAccepted(false);
    setRequestDialogOpen(true);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-4 lg:grid-cols-[6.25rem_minmax(28rem,1.18fr)_minmax(22rem,0.95fr)]">
          <aside className="order-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:order-1">
            <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
              {INITIAL_FILTERS.map((initial) => {
                const active = highlightedInitial === initial;
                const count =
                  initial === ALL_INITIAL
                    ? words.length
                    : initialCounts.get(initial) || 0;
                return (
                  <button
                    key={initial}
                    type="button"
                    onClick={() => handleInitialFilterClick(initial)}
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
          </aside>

          <aside className="order-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:order-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-slate-950">
                내 단어장
              </h2>
              <button
                type="button"
                onClick={handleNewEntry}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
              >
                <i className="fas fa-plus text-[11px]" aria-hidden="true"></i>새
                단어
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_9.25rem] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_9.25rem]">
              <label className="relative block">
                <span className="sr-only">단어 검색</span>
                <i
                  className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                  aria-hidden="true"
                ></i>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="단어 검색"
                />
              </label>
              <label className="block">
                <span className="sr-only">정렬</span>
                <select
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(event.target.value as "alpha" | "recent")
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="alpha">정렬: 가나다순</option>
                  <option value="recent">정렬: 최근 수정</option>
                </select>
              </label>
            </div>

            <div className="mt-5 text-xs font-bold text-slate-500">
              저장된 단어 {words.length}개
            </div>

            <div
              ref={wordListRef}
              onScroll={handleWordListScroll}
              className="mt-4 max-h-[calc(100vh-22rem)] min-h-[26rem] overflow-y-auto pr-1"
            >
              {!visibleWords.length && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                  표시할 단어가 없습니다.
                </div>
              )}

              <div className="space-y-3">
                {groupedVisibleWords.map(([initial, items]) => (
                  <section
                    key={initial}
                    ref={(node) => {
                      if (node) {
                        wordSectionRefs.current[initial] = node;
                      } else {
                        delete wordSectionRefs.current[initial];
                      }
                    }}
                  >
                    <div className="mb-2 px-2 text-sm font-extrabold text-slate-900">
                      {initial}
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => {
                        const active =
                          item.id === selectedWordId ||
                          item.normalizedWord === normalizedCurrentWord;
                        return (
                          <button
                            key={`${item.termId}-${item.requestId || item.id}`}
                            type="button"
                            onClick={() => handleSelectWord(item)}
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
                              <i
                                className={`far fa-bookmark shrink-0 text-sm ${
                                  active ? "text-blue-600" : "text-slate-400"
                                }`}
                                aria-hidden="true"
                              ></i>
                            </div>
                            {item.definition && (
                              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                {item.definition}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </aside>

          <main className="order-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                    {currentWord || "새 단어"}
                  </h2>
                  {selectedWord && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                        selectedWord.status === "saved"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {formatStatusLabel(selectedWord.status)}
                    </span>
                  )}
                </div>
              </div>
              {selectedUpdatedAt && (
                <div className="text-xs font-semibold text-slate-400">
                  마지막 수정 {selectedUpdatedAt}
                </div>
              )}
            </div>

            <section className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-extrabold text-slate-800">
                  단어
                </span>
                <input
                  type="text"
                  value={word}
                  onChange={(event) => {
                    setWord(event.target.value);
                    setSelectedWordId("");
                  }}
                  maxLength={40}
                  className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="예: 율령"
                />
              </label>

              <label className="block">
                <span className="text-sm font-extrabold text-slate-800">
                  내가 이해한 뜻
                </span>
                <textarea
                  value={definition}
                  onChange={(event) => setDefinition(event.target.value)}
                  maxLength={1200}
                  className="mt-2 min-h-[10rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="수업 자료, 교과서, 선생님 설명을 바탕으로 내가 이해한 뜻을 적어 보세요."
                />
                <span className="mt-2 block text-right text-xs font-semibold text-slate-400">
                  {definition.length} / 1200
                </span>
              </label>

              <section>
                <div className="mb-2 text-sm font-extrabold text-slate-800">
                  선생님 뜻풀이
                </div>
                {teacherChecked && teacherTerm ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                        <i
                          className="fas fa-circle-info text-xs"
                          aria-hidden="true"
                        ></i>
                      </div>
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-blue-900">
                          {teacherTerm.definition}
                        </p>
                        <button
                          type="button"
                          onClick={handleSaveTeacherTerm}
                          disabled={busy}
                          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <i
                            className="fas fa-bookmark text-[11px]"
                            aria-hidden="true"
                          ></i>
                          선생님 뜻풀이로 저장
                        </button>
                      </div>
                    </div>
                  </div>
                ) : teacherChecked ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-500">
                    아직 선생님이 등록한 공식 뜻풀이가 없습니다.
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-500">
                    필요한 경우 등록된 선생님 뜻풀이를 확인할 수 있습니다.
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCheckTeacherTerm}
                  disabled={!currentWord || busy}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i
                    className="fas fa-magnifying-glass text-[11px]"
                    aria-hidden="true"
                  ></i>
                  선생님 뜻풀이 확인
                </button>
              </section>

              <section>
                <div className="mb-2 text-sm font-extrabold text-slate-800">
                  관련 단원 / 태그
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                    내 단어장
                  </span>
                  {selectedWord?.studentLevel && (
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                      {selectedWord.studentLevel}
                    </span>
                  )}
                  {hasRequestedCurrentWord && (
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                      선생님 요청 중
                    </span>
                  )}
                  {teacherTerm?.studentLevel && (
                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                      {teacherTerm.studentLevel}
                    </span>
                  )}
                </div>
              </section>

              <button
                type="button"
                onClick={openRequestDialog}
                disabled={!currentWord || hasRequestedCurrentWord || busy}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-5 text-sm font-extrabold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <i
                  className="fas fa-paper-plane text-xs"
                  aria-hidden="true"
                ></i>
                {hasRequestedCurrentWord
                  ? "이미 공식 뜻풀이를 요청한 단어입니다"
                  : "공식 뜻풀이 요청"}
              </button>
            </section>

            <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
              {selectedWord && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-5 text-sm font-extrabold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <i
                    className="fas fa-trash-can text-xs"
                    aria-hidden="true"
                  ></i>
                  삭제
                </button>
              )}
              <button
                type="button"
                onClick={handleNewEntry}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!currentWord || definition.trim().length < 2 || busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <i
                  className="fas fa-floppy-disk text-xs"
                  aria-hidden="true"
                ></i>
                수정 저장
              </button>
            </div>
          </main>
        </div>
      </div>
      {requestDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-dictionary-request-title"
            className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  id="history-dictionary-request-title"
                  className="text-base font-extrabold text-amber-900"
                >
                  공식 뜻풀이 요청
                </h3>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  장난 요청이나 수업과 관련 없는 요청은 기록에 남습니다. 실제로
                  학습 중 궁금한 역사 용어만 요청해 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequestDialogOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="요청 팝업 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <div className="text-xs font-bold text-amber-900">요청 단어</div>
              <div className="mt-1 text-lg font-extrabold text-slate-950">
                {currentWord}
              </div>
            </div>

            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              maxLength={240}
              className="mt-4 min-h-[5.5rem] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              placeholder="어디에서 봤는지, 어떤 점이 헷갈렸는지 적어도 됩니다."
            />
            <div className="mt-1 text-right text-xs font-semibold text-slate-400">
              {memo.length} / 240
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setWarningAccepted(true)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-extrabold transition ${
                  warningAccepted
                    ? "bg-emerald-50 text-emerald-700"
                    : "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                }`}
              >
                <i
                  className={`fas ${warningAccepted ? "fa-check" : "fa-triangle-exclamation"} text-xs`}
                  aria-hidden="true"
                ></i>
                {warningAccepted ? "동의 완료" : "실제 궁금한 요청입니다"}
              </button>
              <button
                type="button"
                onClick={handleRequest}
                disabled={!warningAccepted || busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <i
                  className="fas fa-paper-plane text-xs"
                  aria-hidden="true"
                ></i>
                요청하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryDictionary;
