import React, { useEffect, useMemo, useState } from "react";
import { LoadingOverlay } from "../../components/common/LoadingState";
import { useAppToast } from "../../components/common/AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import {
  approveHistoryDictionaryTermForRequests,
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

const timestampLabel = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const statusLabel = (status: HistoryDictionaryRequest["status"]) => {
  if (status === "needs_approval") return "기존 풀이 승인 필요";
  if (status === "resolved") return "처리 완료";
  if (status === "rejected") return "보류";
  return "새 풀이 필요";
};

const ManageHistoryDictionary: React.FC = () => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [requests, setRequests] = useState<HistoryDictionaryRequest[]>([]);
  const [terms, setTerms] = useState<HistoryDictionaryTerm[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [studentLevel, setStudentLevel] = useState("중학생 수준");
  const [relatedUnitId, setRelatedUnitId] = useState("");
  const [busyMessage, setBusyMessage] = useState("");

  useEffect(() => {
    const unsubscribeRequests = subscribeTeacherHistoryDictionaryRequests(setRequests);
    const unsubscribeTerms = subscribeTeacherHistoryDictionaryTerms(setTerms);
    return () => {
      unsubscribeRequests();
      unsubscribeTerms();
    };
  }, []);

  const openRequests = useMemo(
    () =>
      requests.filter((item) =>
        OPEN_REQUEST_STATUSES.has(String(item.status || "")),
      ),
    [requests],
  );
  const selectedRequest =
    openRequests.find((item) => item.id === selectedRequestId) ||
    openRequests[0] ||
    requests.find((item) => item.id === selectedRequestId) ||
    null;
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
    setWord(selectedRequest.word);
    const term = terms.find(
      (item) =>
        item.normalizedWord === selectedRequest.normalizedWord &&
        item.status === "published",
    );
    setDefinition(term?.definition || "");
    setStudentLevel(term?.studentLevel || "중학생 수준");
    setRelatedUnitId(term?.relatedUnitId || "");
  }, [selectedRequest?.id, terms]);

  const handleSaveTerm = async () => {
    if (!word.trim() || definition.trim().length < 5 || busyMessage) return;
    setBusyMessage("역사 사전 풀이를 저장하고 요청 학생에게 배포하는 중입니다.");
    try {
      await saveHistoryDictionaryTerm(config, {
        word,
        definition,
        studentLevel,
        relatedUnitId,
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

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 lg:text-2xl">
            <i className="fas fa-book-open mr-2 text-blue-500"></i>
            역사 사전 관리
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500">
            학생 요청을 확인하고 수업 맥락에 맞는 뜻풀이를 공개합니다.
          </p>
        </div>
        <div className="rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-extrabold text-blue-700 shadow-sm">
          대기 요청 {openRequests.length}건
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="text-sm font-extrabold text-gray-900">
              학생 요청
            </div>
            <div className="mt-0.5 text-xs font-medium text-gray-500">
              장난 요청 여부와 학습 맥락을 함께 확인해 주세요.
            </div>
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-2">
            {!openRequests.length && (
              <div className="px-4 py-10 text-center text-sm font-semibold text-gray-500">
                대기 중인 요청이 없습니다.
              </div>
            )}
            {openRequests.map((item) => {
              const active = selectedRequest?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedRequestId(item.id)}
                  className={`mb-2 block w-full rounded-lg border px-3 py-3 text-left transition ${
                    active
                      ? "border-blue-300 bg-blue-50"
                      : "border-gray-100 bg-white hover:border-blue-200 hover:bg-blue-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-extrabold text-gray-900">
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
                  <div className="mt-2 text-xs font-semibold text-gray-500">
                    {item.grade}학년 {item.class}반 {item.number}번 ·{" "}
                    {item.studentName || "학생"}
                  </div>
                  {item.memo && (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-gray-600">
                      {item.memo}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] font-bold text-gray-400">
                    {timestampLabel(item.updatedAt || item.createdAt)}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm">
          {!selectedRequest ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                <i className="fas fa-check text-2xl"></i>
              </div>
              <p className="mt-4 text-lg font-bold text-gray-700">
                처리할 역사 사전 요청이 없습니다.
              </p>
            </div>
          ) : (
            <div className="p-4 lg:p-6">
              <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                      요청 단어
                    </div>
                    <div className="mt-1 text-2xl font-extrabold text-gray-900">
                      {selectedRequest.word}
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-gray-600 shadow-sm">
                    같은 단어 대기 {sameWordOpenCount}건
                  </div>
                </div>
                {selectedRequest.memo && (
                  <p className="mt-3 text-sm leading-6 text-gray-700">
                    {selectedRequest.memo}
                  </p>
                )}
              </div>

              {matchingTerm && (
                <section className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold text-emerald-900">
                        이미 등록된 뜻풀이가 있습니다.
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-900">
                        {matchingTerm.definition}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApproveExisting(selectedRequest.id)}
                        disabled={Boolean(busyMessage)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <i className="fas fa-check text-xs"></i>
                        이 요청만 승인
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleApproveExisting()}
                        disabled={Boolean(busyMessage)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-extrabold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        같은 단어 모두 승인
                      </button>
                    </div>
                  </div>
                </section>
              )}

              <section className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
                  <label className="block">
                    <span className="text-sm font-bold text-gray-700">
                      단어
                    </span>
                    <input
                      type="text"
                      value={word}
                      onChange={(event) => setWord(event.target.value)}
                      maxLength={40}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold text-gray-700">
                      풀이 수준
                    </span>
                    <input
                      type="text"
                      value={studentLevel}
                      onChange={(event) => setStudentLevel(event.target.value)}
                      maxLength={80}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-bold text-gray-700">
                    학생용 역사 풀이
                  </span>
                  <textarea
                    value={definition}
                    onChange={(event) => setDefinition(event.target.value)}
                    maxLength={1200}
                    className="mt-1 min-h-[12rem] w-full resize-y rounded-lg border border-gray-200 px-3 py-3 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    placeholder="학생 수준과 현재 수업 맥락에 맞게 풀이를 적어 주세요."
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-gray-700">
                    관련 단원 ID
                  </span>
                  <input
                    type="text"
                    value={relatedUnitId}
                    onChange={(event) => setRelatedUnitId(event.target.value)}
                    maxLength={120}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    placeholder="선택 사항"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSaveTerm()}
                    disabled={
                      Boolean(busyMessage) ||
                      !word.trim() ||
                      definition.trim().length < 5
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                  >
                    <i className="fas fa-floppy-disk text-xs"></i>
                    풀이 저장 및 같은 단어 요청 배포
                  </button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-extrabold text-gray-900">
          등록된 역사 사전
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {terms.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-sm font-extrabold text-gray-900">
                  {item.word}
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                  {item.studentLevel || "학생용"}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-600">
                {item.definition}
              </p>
            </div>
          ))}
        </div>
      </section>

      {busyMessage && <LoadingOverlay message={busyMessage} />}
    </div>
  );
};

export default ManageHistoryDictionary;
