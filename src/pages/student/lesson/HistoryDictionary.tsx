import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { useAppToast } from "../../../components/common/AppToastProvider";
import {
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

const formatStatusLabel = (status: StudentHistoryDictionaryWord["status"]) =>
  status === "saved" ? "저장됨" : "요청 중";

const HistoryDictionary: React.FC = () => {
  const { currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const [words, setWords] = useState<StudentHistoryDictionaryWord[]>([]);
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [memo, setMemo] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [teacherTerm, setTeacherTerm] = useState<HistoryDictionaryTerm | null>(null);
  const [teacherChecked, setTeacherChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentWord = word.trim();
  const normalizedCurrentWord = normalizeHistoryDictionaryWord(currentWord);
  const selectedWord = useMemo(
    () =>
      words.find((item) => item.normalizedWord === normalizedCurrentWord) ||
      null,
    [normalizedCurrentWord, words],
  );
  const hasRequestedCurrentWord = selectedWord?.status === "requested";

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

  const handleSave = async () => {
    if (!currentWord || definition.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      await saveStudentHistoryDictionaryEntry({
        word: currentWord,
        definition: definition.trim(),
      });
      showToast({
        tone: "success",
        title: "내 역사 사전에 저장했습니다.",
        message: `"${currentWord}"을 직접 정리한 단어로 저장했습니다.`,
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

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-slate-900">
            역사 사전
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            학습 중 만난 역사 용어를 내가 이해한 말로 정리합니다.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:p-6">
            <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
              <label className="block">
                <span className="text-sm font-extrabold text-slate-800">
                  단어
                </span>
                <input
                  type="text"
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  maxLength={40}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="예: 율령"
                />
              </label>
              <div className="rounded-lg bg-blue-50 px-3 py-3 text-xs font-bold leading-5 text-blue-700">
                선생님 풀이가 없어도 먼저 내 단어장에 직접 정리할 수 있습니다.
              </div>
            </section>

            <label className="mt-4 block">
              <span className="text-sm font-extrabold text-slate-800">
                내가 이해한 뜻풀이
              </span>
              <textarea
                value={definition}
                onChange={(event) => setDefinition(event.target.value)}
                maxLength={1200}
                className="mt-1 min-h-[13rem] w-full resize-y rounded-lg border border-slate-200 px-3 py-3 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                placeholder="수업 자료, 교과서, 선생님 설명을 바탕으로 내가 이해한 뜻을 적어 보세요."
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCheckTeacherTerm}
                disabled={!currentWord || busy}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fas fa-circle-question text-xs"></i>
                선생님 뜻풀이 확인
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!currentWord || definition.trim().length < 2 || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <i className="fas fa-floppy-disk text-xs"></i>
                내 역사 사전에 저장
              </button>
            </div>

            {teacherChecked && (
              <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                {teacherTerm ? (
                  <>
                    <div className="text-sm font-extrabold text-slate-900">
                      선생님 뜻풀이
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {teacherTerm.definition}
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveTeacherTerm}
                      disabled={busy}
                      className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      선생님 뜻풀이로 저장
                    </button>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-600">
                    아직 선생님이 등록한 공식 뜻풀이가 없습니다. 먼저 내
                    뜻풀이로 정리해 보세요.
                  </p>
                )}
              </section>
            )}

            <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-extrabold text-amber-900">
                선생님께 공식 뜻풀이 요청
              </div>
              <p className="mt-2 text-xs leading-5 text-amber-800">
                장난 요청이나 수업과 관련 없는 요청은 기록에 남습니다. 실제로
                학습 중 궁금한 역사 용어만 요청해 주세요.
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
                className="mt-3 min-h-[4.5rem] w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                placeholder="어디에서 봤는지, 어떤 점이 헷갈렸는지 적어도 됩니다."
              />
              <button
                type="button"
                onClick={handleRequest}
                disabled={!currentWord || !warningAccepted || hasRequestedCurrentWord || busy}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                <i className="fas fa-paper-plane text-xs"></i>
                {hasRequestedCurrentWord ? "이미 요청한 단어입니다" : "선생님께 요청"}
              </button>
            </section>
          </main>

          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-extrabold text-slate-900">
              내 단어장
            </div>
            {!words.length && (
              <div className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
                저장한 단어가 없습니다.
              </div>
            )}
            <div className="space-y-2">
              {words.map((item) => (
                <button
                  key={`${item.termId}-${item.requestId || item.id}`}
                  type="button"
                  onClick={() => {
                    setWord(item.word);
                    setDefinition(item.definition || "");
                  }}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-extrabold text-slate-900">
                      {item.word}
                    </span>
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
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default HistoryDictionary;
