import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  loadPublishedHistoryDictionaryTerm,
  normalizeHistoryDictionaryWord,
  requestHistoryDictionaryTerm,
  saveStudentHistoryDictionaryWord,
  subscribeStudentHistoryDictionaryWords,
} from "../../lib/historyDictionary";
import type {
  HistoryDictionaryTerm,
  StudentHistoryDictionaryWord,
} from "../../types";
import { useAppToast } from "./AppToastProvider";

const getFloatingOffsetClassName = (pathname: string) => {
  if (pathname.startsWith("/student/lesson/note")) {
    return "bottom-[calc(env(safe-area-inset-bottom,0px)+9.75rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)]";
  }
  if (pathname.startsWith("/student/score")) {
    return "bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)]";
  }
  return "bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)]";
};

const formatStatusLabel = (status: StudentHistoryDictionaryWord["status"]) =>
  status === "saved" ? "등록 완료" : "요청 중";

const StudentHistoryDictionaryController: React.FC = () => {
  const { currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [memo, setMemo] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [term, setTerm] = useState<HistoryDictionaryTerm | null>(null);
  const [words, setWords] = useState<StudentHistoryDictionaryWord[]>([]);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isStudentRoute = location.pathname.startsWith("/student");
  const currentWord = word.trim();
  const normalizedCurrentWord = normalizeHistoryDictionaryWord(currentWord);
  const hasSavedCurrentWord = useMemo(
    () =>
      words.some(
        (item) =>
          item.normalizedWord === normalizedCurrentWord &&
          item.status === "saved",
      ),
    [normalizedCurrentWord, words],
  );
  const hasRequestedCurrentWord = useMemo(
    () =>
      words.some(
        (item) =>
          item.normalizedWord === normalizedCurrentWord &&
          item.status === "requested",
      ),
    [normalizedCurrentWord, words],
  );

  useEffect(() => {
    if (!currentUser?.uid || !isStudentRoute) {
      setWords([]);
      return undefined;
    }
    return subscribeStudentHistoryDictionaryWords(currentUser.uid, setWords);
  }, [currentUser?.uid, isStudentRoute]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setSearched(false);
    setTerm(null);
    setWarningAccepted(false);
  }, [word]);

  if (!currentUser || !isStudentRoute) return null;

  const handleSearch = async () => {
    if (!currentWord || loading) return;
    setLoading(true);
    setSearched(false);
    try {
      const result = await loadPublishedHistoryDictionaryTerm(currentWord);
      setTerm(result);
      setSearched(true);
    } catch (error) {
      console.error("Failed to search history dictionary:", error);
      showToast({
        tone: "error",
        title: "역사 사전을 불러오지 못했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!term || loading) return;
    setLoading(true);
    try {
      await saveStudentHistoryDictionaryWord(term.id);
      showToast({
        tone: "success",
        title: "내 단어장에 저장했습니다.",
        message: `"${term.word}" 뜻풀이를 다시 볼 수 있습니다.`,
      });
    } catch (error) {
      console.error("Failed to save history dictionary word:", error);
      showToast({
        tone: "error",
        title: "단어장 저장에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async () => {
    if (!currentWord || !warningAccepted || loading) return;
    setLoading(true);
    try {
      await requestHistoryDictionaryTerm(config, {
        word: currentWord,
        memo,
        warningAccepted,
      });
      setMemo("");
      setWarningAccepted(false);
      showToast({
        tone: "success",
        title: "선생님께 요청을 보냈습니다.",
        message: "학습에 필요한 요청인지 확인한 뒤 뜻풀이가 등록됩니다.",
      });
    } catch (error) {
      console.error("Failed to request history dictionary term:", error);
      showToast({
        tone: "error",
        title: "요청을 보내지 못했습니다.",
        message: "단어를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed z-[80] inline-flex h-14 w-14 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-700 shadow-[0_18px_42px_rgba(37,99,235,0.22)] transition hover:-translate-y-0.5 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${getFloatingOffsetClassName(location.pathname)}`}
        aria-label="역사 사전 열기"
        title="역사 사전"
      >
        <i className="fas fa-book-open text-lg" aria-hidden="true"></i>
      </button>

      {open && (
        <div className="fixed inset-0 z-[115] bg-slate-950/35 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-dictionary-title"
            className="absolute bottom-0 right-0 flex h-[min(82vh,680px)] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-4 sm:right-4 sm:h-[min(76vh,680px)] sm:w-[400px] sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2
                  id="history-dictionary-title"
                  className="text-base font-extrabold text-slate-900"
                >
                  역사 사전
                </h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  수업 중 헷갈린 역사 용어를 확인합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="역사 사전 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSearch();
                }}
              >
                <label className="sr-only" htmlFor="history-dictionary-word">
                  찾을 단어
                </label>
                <input
                  ref={inputRef}
                  id="history-dictionary-word"
                  type="text"
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  maxLength={40}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="예: 율령"
                />
                <button
                  type="submit"
                  disabled={!currentWord || loading}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200"
                  aria-label="역사 사전 검색"
                >
                  <i className="fas fa-magnifying-glass text-sm" aria-hidden="true"></i>
                </button>
              </form>

              {searched && term && (
                <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-extrabold text-slate-900">
                        {term.word}
                      </div>
                      <div className="mt-1 text-xs font-bold text-blue-700">
                        {term.studentLevel || "학생용 풀이"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={loading || hasSavedCurrentWord}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-default disabled:bg-blue-100 disabled:text-blue-600"
                    >
                      <i className="fas fa-bookmark text-[11px]" aria-hidden="true"></i>
                      {hasSavedCurrentWord ? "저장됨" : "저장"}
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {term.definition}
                  </p>
                </section>
              )}

              {searched && !term && (
                <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-extrabold text-amber-900">
                    아직 등록되지 않은 단어입니다.
                  </div>
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    요청은 선생님이 확인합니다. 장난 요청이나 수업과 관련 없는
                    요청은 기록에 남으며, 필요한 경우 선생님이 따로 확인할 수
                    있습니다.
                  </p>
                  <label className="mt-3 flex items-start gap-2 rounded-lg bg-white/70 p-3 text-xs font-bold leading-5 text-amber-900">
                    <input
                      type="checkbox"
                      checked={warningAccepted}
                      onChange={(event) => setWarningAccepted(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-blue-600 focus:ring-blue-500"
                    />
                    학습 중 실제로 궁금한 역사 용어만 요청하겠습니다.
                  </label>
                  <textarea
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    maxLength={240}
                    className="mt-3 min-h-[5.5rem] w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    placeholder="어디에서 봤는지, 어떤 점이 헷갈렸는지 적어도 됩니다."
                  />
                  <button
                    type="button"
                    onClick={handleRequest}
                    disabled={loading || !warningAccepted || hasRequestedCurrentWord}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <i className="fas fa-paper-plane text-xs" aria-hidden="true"></i>
                    {hasRequestedCurrentWord ? "이미 요청한 단어입니다" : "선생님께 뜻풀이 요청"}
                  </button>
                </section>
              )}

              <section className="mt-5">
                <div className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">
                  내 단어장
                </div>
                {!words.length && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
                    저장한 단어가 없습니다.
                  </div>
                )}
                <div className="space-y-2">
                  {words.map((item) => (
                    <div
                      key={`${item.termId}-${item.requestId || item.id}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-extrabold text-slate-900">
                          {item.word}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            item.status === "saved"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {formatStatusLabel(item.status)}
                        </span>
                      </div>
                      {item.definition && (
                        <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">
                          {item.definition}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentHistoryDictionaryController;
