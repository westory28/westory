import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteStudentHistoryDictionaryWord,
  loadPublishedHistoryDictionaryTerm,
  normalizeHistoryDictionaryWord,
  requestHistoryDictionaryTerm,
  saveStudentHistoryDictionaryEntry,
  saveStudentHistoryDictionaryWord,
  subscribeStudentHistoryDictionaryWords,
} from "../../lib/historyDictionary";
import { getHistoryDictionaryErrorMessage } from "../../lib/historyDictionarySession";
import type {
  HistoryDictionaryTerm,
  StudentHistoryDictionaryWord,
} from "../../types";
import type { HistoryDictionaryCatalogTerm } from "../../lib/historyDictionaryCatalog";
import HistoryDictionaryCatalogBrowser, {
  HistoryDictionaryAttribution,
} from "./HistoryDictionaryCatalogBrowser";
import HistoryDictionaryInitialFilter from "./HistoryDictionaryInitialFilter";
import {
  getHistoryDictionaryInitialCounts,
  matchesHistoryDictionaryInitial,
} from "../../lib/historyDictionaryInitials";

export default function StudentHistoryDictionaryWorkspace() {
  const { currentUser, config, configReady } = useAuth();
  const [view, setView] = useState<"catalog" | "notebook">("catalog");
  const [words, setWords] = useState<StudentHistoryDictionaryWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [wordsError, setWordsError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [initial, setInitial] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [reference, setReference] =
    useState<HistoryDictionaryCatalogTerm | null>(null);
  const [teacherTerm, setTeacherTerm] = useState<HistoryDictionaryTerm | null>(
    null,
  );
  const [teacherChecked, setTeacherChecked] = useState(false);
  const [teacherError, setTeacherError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const pending = useRef(false);
  const editorRef = useRef<HTMLElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const definitionRef = useRef<HTMLTextAreaElement>(null);
  const wordListRef = useRef<HTMLDivElement>(null);
  const baseDraft = useRef({ word: "", definition: "" });
  const id = useId();
  const scopeKey = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}`;
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const ready = Boolean(currentUser?.uid && configReady && config);
  const currentWord = word.trim();
  const normalizedWord = normalizeHistoryDictionaryWord(currentWord);
  const selectedWord =
    words.find((item) => item.normalizedWord === normalizedWord) || null;
  const requested = selectedWord?.status === "requested";
  const initialCounts = useMemo(
    () => getHistoryDictionaryInitialCounts(words.map((item) => item.word)),
    [words],
  );
  const visibleWords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ko-KR");
    return words
      .filter(
        (item) =>
          matchesHistoryDictionaryInitial(item.word, initial) &&
          (!needle ||
            `${item.word} ${item.definition || ""}`
              .toLocaleLowerCase("ko-KR")
              .includes(needle)),
      )
      .sort((a, b) => a.word.localeCompare(b.word, "ko-KR"));
  }, [initial, search, words]);

  useEffect(() => {
    wordListRef.current?.scrollTo({ top: 0 });
  }, [initial, search]);

  useEffect(() => {
    // A new object also invalidates work from an earlier visit to this account
    // and semester, including a rapid account switch back to the same UID.
    scopeRef.current = { key: scopeKey };
    setWords([]);
    setInitial("");
    setWord("");
    setDefinition("");
    setReference(null);
    setRequestOpen(false);
    setMemo("");
    setWarningAccepted(false);
    setTeacherTerm(null);
    setTeacherChecked(false);
    setTeacherError("");
    setFeedback("");
    setError("");
    setBusy("");
    pending.current = false;
    baseDraft.current = { word: "", definition: "" };
    return () => {
      scopeRef.current = { key: "" };
    };
  }, [scopeKey]);

  useEffect(() => {
    if (!ready || !currentUser?.uid) {
      setWordsLoading(!configReady);
      return;
    }
    let active = true;
    setWordsLoading(true);
    setWordsError("");
    const unsubscribe = subscribeStudentHistoryDictionaryWords(
      currentUser.uid,
      (items) => {
        if (!active) return;
        setWords(items);
        setWordsLoading(false);
        setWordsError("");
      },
      config,
      (failure) => {
        if (!active) return;
        setWordsLoading(false);
        setWordsError(getHistoryDictionaryErrorMessage(failure));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scopeKey, ready, retry]);

  useEffect(() => {
    setTeacherTerm(null);
    setTeacherChecked(false);
    setTeacherError("");
    setRequestOpen(false);
    setWarningAccepted(false);
  }, [word]);

  const focusEditor = (meaning = false) => {
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: "nearest" });
      (meaning ? definitionRef.current : wordRef.current)?.focus({
        preventScroll: true,
      });
    });
  };

  const replaceDraft = (
    nextWord = "",
    nextDefinition = "",
    entry: HistoryDictionaryCatalogTerm | null = null,
  ) => {
    if (pending.current) return;
    const dirty =
      word !== baseDraft.current.word ||
      definition !== baseDraft.current.definition;
    if (
      dirty &&
      !window.confirm(
        "아직 저장하지 않은 내용이 있습니다. 다른 단어로 이동할까요?",
      )
    )
      return;
    setWord(nextWord);
    setDefinition(nextDefinition);
    setReference(entry);
    setMemo("");
    setError("");
    setFeedback("");
    setView("notebook");
    baseDraft.current = { word: nextWord, definition: nextDefinition };
    focusEditor(Boolean(nextWord));
  };

  const run = async (
    action: string,
    work: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (pending.current || !ready) return;
    const startedScope = scopeRef.current;
    const isCurrent = () => scopeRef.current === startedScope;
    pending.current = true;
    setBusy(action);
    setError("");
    setFeedback("");
    try {
      await work(isCurrent);
    } catch (failure) {
      if (isCurrent()) setError(getHistoryDictionaryErrorMessage(failure));
    } finally {
      if (isCurrent()) {
        pending.current = false;
        setBusy("");
      }
    }
  };

  const save = () => {
    if (!currentWord || definition.trim().length < 2) return;
    if (reference && definition.trim() === reference.definition.trim()) {
      setError(
        "사전 뜻풀이를 그대로 옮기지 말고, 이해한 내용을 자신의 말로 적어 주세요.",
      );
      definitionRef.current?.focus();
      return;
    }
    void run("save", async (isCurrent) => {
      const result = await saveStudentHistoryDictionaryEntry({
        config,
        word: currentWord,
        definition: definition.trim(),
      });
      if (!isCurrent()) return;
      baseDraft.current = { word, definition };
      setFeedback(
        result.reward?.awarded
          ? `저장했습니다. ${Number(result.reward.amount || 0)}위스를 받았습니다.`
          : "내 단어장에 저장했습니다.",
      );
    });
  };

  const remove = () => {
    if (
      !selectedWord?.termId ||
      !window.confirm(
        `“${selectedWord.word}”을 내 단어장에서 삭제할까요? 지급된 사전 위스가 있으면 함께 회수됩니다.`,
      )
    )
      return;
    void run("delete", async (isCurrent) => {
      const result = await deleteStudentHistoryDictionaryWord(
        config,
        selectedWord.termId,
      );
      if (!isCurrent()) return;
      setWord("");
      setDefinition("");
      setReference(null);
      baseDraft.current = { word: "", definition: "" };
      setFeedback(
        result.reward?.reclaimed
          ? `삭제했습니다. 지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
          : "단어를 삭제했습니다.",
      );
    });
  };

  const checkTeacher = () => {
    if (!currentWord) return;
    setTeacherError("");
    void run("lookup", async (isCurrent) => {
      try {
        const term = await loadPublishedHistoryDictionaryTerm(
          currentWord,
          config,
        );
        if (!isCurrent()) return;
        setTeacherTerm(term);
        setTeacherChecked(true);
      } catch (failure) {
        if (isCurrent()) {
          setTeacherError(getHistoryDictionaryErrorMessage(failure));
          setTeacherChecked(false);
        }
      }
    });
  };

  const saveTeacher = () => {
    if (!teacherTerm) return;
    void run("teacher-save", async (isCurrent) => {
      await saveStudentHistoryDictionaryWord(teacherTerm.id, config);
      if (!isCurrent()) return;
      setDefinition(teacherTerm.definition);
      baseDraft.current = { word, definition: teacherTerm.definition };
      setFeedback("선생님 뜻풀이를 내 단어장에 저장했습니다.");
    });
  };

  const sendRequest = () => {
    if (!currentWord || !warningAccepted || requested) return;
    void run("request", async (isCurrent) => {
      await requestHistoryDictionaryTerm(config, {
        word: currentWord,
        memo: memo.trim(),
        warningAccepted,
      });
      if (!isCurrent()) return;
      setRequestOpen(false);
      setWarningAccepted(false);
      setMemo("");
      setFeedback("선생님께 뜻풀이 요청을 보냈습니다.");
    });
  };

  return (
    <div className="history-dictionary-workspace">
      <div className="ws-page-tabs" role="group" aria-label="사전 보기">
        <button
          type="button"
          aria-pressed={view === "catalog"}
          disabled={Boolean(busy)}
          onClick={() => setView("catalog")}
        >
          사전 찾기
        </button>
        <button
          type="button"
          aria-pressed={view === "notebook"}
          disabled={Boolean(busy)}
          onClick={() => setView("notebook")}
        >
          내 단어장
        </button>
      </div>
      <div hidden={view !== "catalog"}>
        <HistoryDictionaryCatalogBrowser
          disabled={Boolean(busy)}
          onChoose={(entry) => {
            const existing = words.find(
              (item) =>
                item.normalizedWord ===
                normalizeHistoryDictionaryWord(entry.word),
            );
            replaceDraft(entry.word, existing?.definition || "", entry);
          }}
        />
      </div>
      {view === "notebook" && (
        <div className="history-dictionary-notebook">
          <section
            className="history-dictionary-initial-region"
            aria-label="저장한 단어"
          >
            <div className="history-dictionary-row">
              <h2>
                내 단어장{" "}
                <span className="history-dictionary-count">
                  {words.length}개
                </span>
              </h2>
              <button
                className="history-dictionary-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => replaceDraft()}
              >
                새 단어
              </button>
            </div>
            <div className="history-dictionary-initial-layout">
              <div className="history-dictionary-initial-content">
                <label
                  className="history-dictionary-field"
                  htmlFor={`${id}-notebook-search`}
                >
                  <span className="sr-only">내 단어 검색</span>
                  <input
                    id={`${id}-notebook-search`}
                    type="search"
                    value={search}
                    placeholder="내 단어 검색"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                {wordsError && (
                  <div className="history-dictionary-error" role="alert">
                    <p>내 단어장을 불러오지 못했습니다. {wordsError}</p>
                    <button
                      className="history-dictionary-button"
                      type="button"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      다시 불러오기
                    </button>
                  </div>
                )}
                {wordsLoading ? (
                  <p className="history-dictionary-empty" role="status">
                    내 단어장을 불러오는 중입니다.
                  </p>
                ) : !wordsError && !visibleWords.length ? (
                  <p className="history-dictionary-empty">
                    {search || initial
                      ? "검색 결과가 없습니다."
                      : "아직 저장한 단어가 없습니다."}
                  </p>
                ) : null}
                <div className="history-dictionary-word-list" ref={wordListRef}>
                  {visibleWords.map((item) => (
                    <button
                      key={item.id}
                      className="history-dictionary-word"
                      type="button"
                      aria-pressed={item.normalizedWord === normalizedWord}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        replaceDraft(item.word, item.definition || "")
                      }
                    >
                      <span className="history-dictionary-row">
                        <strong>{item.word}</strong>
                        <span className="history-dictionary-count">
                          {item.status === "requested" ? "요청 중" : "저장됨"}
                        </span>
                      </span>
                      {item.definition && <p>{item.definition}</p>}
                    </button>
                  ))}
                </div>
              </div>
              <HistoryDictionaryInitialFilter
                value={initial}
                onChange={setInitial}
                counts={initialCounts}
                label="내 단어장 첫 글자"
              />
            </div>
          </section>
          <section
            className="history-dictionary-editor"
            ref={editorRef}
            aria-label="단어 정리"
            aria-busy={Boolean(busy)}
          >
            <h2>{selectedWord ? "단어 수정" : "새 단어 등록"}</h2>
            <fieldset disabled={Boolean(busy) || !ready}>
              <label
                className="history-dictionary-field"
                htmlFor={`${id}-word`}
              >
                <span>단어</span>
                <input
                  id={`${id}-word`}
                  ref={wordRef}
                  type="text"
                  lang="ko"
                  value={word}
                  maxLength={40}
                  placeholder="예: 율령"
                  onChange={(event) => {
                    setWord(event.target.value);
                    setError("");
                    setFeedback("");
                    if (
                      reference &&
                      normalizeHistoryDictionaryWord(event.target.value) !==
                        normalizeHistoryDictionaryWord(reference.word)
                    )
                      setReference(null);
                  }}
                />
              </label>
              {reference && (
                <details className="history-dictionary-reference">
                  <summary>사전 뜻풀이 참고 · {reference.word}</summary>
                  <p className="history-dictionary-definition">
                    {reference.definition}
                  </p>
                  <HistoryDictionaryAttribution entry={reference} />
                </details>
              )}
              <label
                className="history-dictionary-field"
                htmlFor={`${id}-definition`}
              >
                <span>내가 이해한 뜻</span>
                <textarea
                  id={`${id}-definition`}
                  ref={definitionRef}
                  lang="ko"
                  value={definition}
                  maxLength={1200}
                  minLength={2}
                  placeholder="내 말로 뜻을 정리해 보세요."
                  aria-describedby={`${id}-definition-length`}
                  onChange={(event) => {
                    setDefinition(event.target.value);
                    setError("");
                    setFeedback("");
                  }}
                />
                <span
                  id={`${id}-definition-length`}
                  className="history-dictionary-count"
                >
                  2자 이상 · {definition.length} / 1200
                </span>
              </label>
              <div className="history-dictionary-actions">
                {selectedWord && (
                  <button
                    className="history-dictionary-button is-danger"
                    type="button"
                    onClick={remove}
                  >
                    {busy === "delete" ? "삭제 중…" : "삭제"}
                  </button>
                )}
                <button
                  className="history-dictionary-button is-primary"
                  type="button"
                  disabled={!currentWord || definition.trim().length < 2}
                  onClick={save}
                >
                  {busy === "save"
                    ? "저장 중…"
                    : selectedWord
                      ? "수정 저장"
                      : "내 단어장에 저장"}
                </button>
              </div>
            </fieldset>
            {!ready && (
              <p className="history-dictionary-error" role="alert">
                {configReady
                  ? "로그인과 학기 정보를 확인한 뒤 다시 이용해 주세요."
                  : "학기 정보를 확인하고 있습니다."}
              </p>
            )}
            {error && (
              <p className="history-dictionary-error" role="alert">
                {error}
              </p>
            )}
            {feedback && (
              <p className="history-dictionary-feedback" role="status">
                {feedback}
              </p>
            )}
            <section className="history-dictionary-teacher">
              <div className="history-dictionary-row">
                <h3 className="font-bold">선생님 뜻풀이</h3>
                <button
                  className="history-dictionary-button"
                  type="button"
                  disabled={!currentWord || Boolean(busy) || !ready}
                  onClick={checkTeacher}
                >
                  {busy === "lookup"
                    ? "확인 중…"
                    : teacherError
                      ? "다시 확인"
                      : "확인"}
                </button>
              </div>
              {teacherError && (
                <p className="history-dictionary-error" role="alert">
                  {teacherError}
                </p>
              )}
              {teacherChecked &&
                (teacherTerm ? (
                  <>
                    <p className="history-dictionary-definition">
                      {teacherTerm.definition}
                    </p>
                    <button
                      className="history-dictionary-button"
                      type="button"
                      disabled={Boolean(busy) || !ready}
                      onClick={saveTeacher}
                    >
                      {busy === "teacher-save"
                        ? "저장 중…"
                        : "선생님 뜻풀이로 저장"}
                    </button>
                  </>
                ) : (
                  <p className="history-dictionary-count">
                    등록된 선생님 뜻풀이가 없습니다.
                  </p>
                ))}
              <div className="history-dictionary-actions mt-3">
                <button
                  className="history-dictionary-button"
                  type="button"
                  aria-expanded={requestOpen}
                  disabled={
                    !currentWord || requested || Boolean(busy) || !ready
                  }
                  onClick={() => {
                    setWarningAccepted(false);
                    setRequestOpen((value) => !value);
                  }}
                >
                  {requested
                    ? "뜻풀이 요청 중"
                    : requestOpen
                      ? "요청 닫기"
                      : "선생님께 뜻풀이 요청"}
                </button>
              </div>
              {requestOpen && (
                <div className="history-dictionary-request">
                  <h3 className="font-bold">뜻풀이 요청 · {currentWord}</h3>
                  <label
                    className="history-dictionary-field"
                    htmlFor={`${id}-memo`}
                  >
                    <span>궁금한 점 (선택)</span>
                    <textarea
                      id={`${id}-memo`}
                      lang="ko"
                      value={memo}
                      maxLength={240}
                      disabled={Boolean(busy)}
                      onChange={(event) => setMemo(event.target.value)}
                    />
                  </label>
                  <label className="history-dictionary-consent">
                    <input
                      type="checkbox"
                      checked={warningAccepted}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        setWarningAccepted(event.target.checked)
                      }
                    />
                    <span>
                      학습 중 궁금한 단어이며 선생님께 요청 내용을 보냅니다.
                    </span>
                  </label>
                  <button
                    className="history-dictionary-button is-primary"
                    type="button"
                    disabled={!warningAccepted || Boolean(busy) || !ready}
                    onClick={sendRequest}
                  >
                    {busy === "request" ? "요청 중…" : "요청 보내기"}
                  </button>
                </div>
              )}
            </section>
          </section>
        </div>
      )}
    </div>
  );
}
