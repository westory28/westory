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

const ManageHistoryDictionary: React.FC = () => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const [requests, setRequests] = useState<HistoryDictionaryRequest[]>([]);
  const [terms, setTerms] = useState<HistoryDictionaryTerm[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [studentLevel, setStudentLevel] = useState("중학생 수준");
  const [relatedUnitId, setRelatedUnitId] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [termSearch, setTermSearch] = useState("");

  useEffect(() => {
    const unsubscribeRequests =
      subscribeTeacherHistoryDictionaryRequests(setRequests);
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

  const visibleRequests = useMemo(() => {
    const keyword = requestSearch.trim().toLowerCase();
    return openRequests.filter((item) => {
      if (!keyword) return true;
      return (
        item.word.toLowerCase().includes(keyword) ||
        (item.studentName || "").toLowerCase().includes(keyword) ||
        (item.memo || "").toLowerCase().includes(keyword)
      );
    });
  }, [openRequests, requestSearch]);

  const visibleTerms = useMemo(() => {
    const keyword = termSearch.trim().toLowerCase();
    return [...terms]
      .filter((item) => {
        if (!keyword) return true;
        return (
          item.word.toLowerCase().includes(keyword) ||
          (item.definition || "").toLowerCase().includes(keyword) ||
          (item.studentLevel || "").toLowerCase().includes(keyword)
        );
      })
      .sort(
        (a, b) =>
          getTimestampMs(b.updatedAt || b.publishedAt || b.createdAt) -
          getTimestampMs(a.updatedAt || a.publishedAt || a.createdAt),
      );
  }, [termSearch, terms]);

  const selectedRequest =
    (selectedRequestId
      ? openRequests.find((item) => item.id === selectedRequestId)
      : null) ||
    (!selectedTermId ? openRequests[0] : null) ||
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
  }, [selectedRequest?.id, terms]);

  useEffect(() => {
    if (!selectedTerm) return;
    setWord(selectedTerm.word);
    setDefinition(selectedTerm.definition || "");
    setStudentLevel(selectedTerm.studentLevel || "중학생 수준");
    setRelatedUnitId(selectedTerm.relatedUnitId || "");
  }, [selectedTerm]);

  const handleSelectRequest = (requestId: string) => {
    setSelectedRequestId(requestId);
    setSelectedTermId("");
  };

  const handleSelectTerm = (term: HistoryDictionaryTerm) => {
    setSelectedTermId(term.id);
    setSelectedRequestId("");
  };

  const handleNewTerm = () => {
    setSelectedRequestId("");
    setSelectedTermId("__new__");
    setWord("");
    setDefinition("");
    setStudentLevel("중학생 수준");
    setRelatedUnitId("");
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
    <div className="min-h-screen bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">
              역사 사전 관리
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              학생 요청을 확인하고 수업 맥락에 맞는 뜻풀이를 등록합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-extrabold text-blue-700 shadow-sm">
              대기 요청 {openRequests.length}건
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 shadow-sm">
              등록 풀이 {terms.length}개
            </span>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.62fr)_minmax(21rem,0.72fr)_minmax(0,1.15fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  학생 요청
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  요청 맥락과 장난 요청 여부를 함께 확인합니다.
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

          <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-slate-950">
                등록된 역사 사전
              </h2>
              <button
                type="button"
                onClick={handleNewTerm}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
              >
                <i className="fas fa-plus text-[11px]" aria-hidden="true"></i>새
                풀이
              </button>
            </div>

            <label className="relative mt-5 block">
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

            <div className="mt-4 max-h-[calc(100vh-18rem)] min-h-[26rem] overflow-y-auto pr-1">
              {!visibleTerms.length && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                  등록된 뜻풀이가 없습니다.
                </div>
              )}
              <div className="space-y-2">
                {visibleTerms.map((item) => {
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
                            active ? "text-blue-700" : "text-slate-900"
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
                      <div className="mt-2 text-[11px] font-bold text-slate-400">
                        {timestampLabel(
                          item.updatedAt || item.publishedAt || item.createdAt,
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

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
                  <div className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 shadow-sm">
                    같은 단어 대기 {sameWordOpenCount}건
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

              <label className="block">
                <span className="text-sm font-extrabold text-slate-800">
                  관련 단원 ID
                </span>
                <input
                  type="text"
                  value={relatedUnitId}
                  onChange={(event) => setRelatedUnitId(event.target.value)}
                  maxLength={120}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="선택 사항"
                />
              </label>

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
