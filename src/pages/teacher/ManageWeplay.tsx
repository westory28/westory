import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
  canReadPoints,
} from "../../lib/permissions";
import {
  getWeplayManagement,
  saveWeplayGameSettings,
  previewWeplayGame,
  normalizeWeplayAnswer,
  weplayErrorMessage,
  WEPLAY_GAMES,
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayGameSettings,
  type WeplayManagement,
  type WeplayDifficulty,
  type WeplaySession,
  type WeplayResult,
} from "../../lib/weplay";
import { createWeplayPreviewTransport } from "../../lib/weplayPreview";
import HistoryRainGame, {
  type HistoryRainTransport,
} from "../../components/common/weplay/HistoryRainGame";
import TeacherSubNavigation from "./components/TeacherSubNavigation";
import TeacherNavigationIcon from "../../components/layout/TeacherNavigationIcon";
import "../../components/common/weplay/weplay.css";
import "./ManageWeplay.css";

export default function ManageWeplay() {
  const { config, currentUser, userData } = useAuth();
  const [params] = useSearchParams();
  const game =
    WEPLAY_GAMES.find((item) => item.id === params.get("game")) ||
    WEPLAY_GAMES[0];
  const canRead = canReadLessonManagement(userData, currentUser?.email);
  const canWrite = canWriteLessonManagement(userData, currentUser?.email);
  const [data, setData] = useState<WeplayManagement | null>(null);
  const [draft, setDraft] = useState<WeplayGameSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [removedSourceCount, setRemovedSourceCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<WeplayDifficulty>("mild");
  const [preview, setPreview] = useState<{
    session: WeplaySession;
    transport: HistoryRainTransport;
  } | null>(null);
  const [result, setResult] = useState<WeplayResult | null>(null);
  const generation = useRef(0);
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}/${game.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dirty =
    !!draft &&
    !!data &&
    JSON.stringify(draft) !== JSON.stringify(data.settings);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    setReloadRequired(false);
    try {
      const response = await getWeplayManagement(config, game.id);
      if (token !== generation.current) return;
      setData(response);
      const knownUnits = new Set(response.lessons.map((item) => item.unitId));
      const unitIds = response.settings.unitIds.filter((id) =>
        knownUnits.has(id),
      );
      setRemovedSourceCount(response.settings.unitIds.length - unitIds.length);
      setDraft({ ...response.settings, unitIds });
    } catch (caught) {
      if (token === generation.current)
        setError(
          weplayErrorMessage(
            caught,
            "게임 정보를 불러오지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [config?.year, config?.semester, currentUser?.uid, game.id]);
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setData(null);
    setDraft(null);
    setFeedback("");
    setReloadRequired(false);
    setRemovedSourceCount(0);
    setSaving(false);
    setStarting(false);
    if (canRead && currentUser && config?.year && config?.semester) void load();
    else setLoading(false);
    return () => {
      generation.current++;
    };
  }, [load, canRead]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const selectedLessons =
    data?.lessons.filter(
      (item) =>
        draft?.sourceMode === "all" || draft?.unitIds.includes(item.unitId),
    ) || [];
  const countWords = (publicOnly: boolean) =>
    new Set(
      selectedLessons
        .filter((item) => !publicOnly || item.isVisibleToStudents)
        .flatMap((item) => item.words.map(normalizeWeplayAnswer)),
    ).size;
  const previewCount = countWords(false);
  const availableCount = countWords(true);
  const update = (next: Partial<WeplayGameSettings>) => {
    setDraft((previous) => (previous ? { ...previous, ...next } : previous));
    setFeedback("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !canWrite || saving || !dirty) return;
    const requestedScope = scope;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await saveWeplayGameSettings(config, game.id, draft);
      if (scopeRef.current !== requestedScope) return;
      setData(response);
      setDraft(response.settings);
      setRemovedSourceCount(0);
      setReloadRequired(false);
      setFeedback("게임 설정을 저장했습니다.");
    } catch (caught) {
      if (scopeRef.current === requestedScope)
        setReloadRequired(
          String((caught as { code?: string })?.code || "").includes("aborted"),
        );
      if (scopeRef.current === requestedScope)
        setError(
          weplayErrorMessage(
            caught,
            "설정을 저장하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (scopeRef.current === requestedScope) setSaving(false);
    }
  };
  const startPreview = async () => {
    if (starting || previewCount < 3) return;
    const requestedScope = scope;
    setStarting(true);
    setError("");
    try {
      const session = await previewWeplayGame(
        config,
        game.id,
        difficulty,
        selectedLessons.map((item) => item.unitId),
      );
      if (scopeRef.current !== requestedScope) return;
      setResult(null);
      setPreview({ session, transport: createWeplayPreviewTransport(session) });
    } catch (caught) {
      if (scopeRef.current === requestedScope)
        setError(
          weplayErrorMessage(
            caught,
            "체험을 시작하지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (scopeRef.current === requestedScope) setStarting(false);
    }
  };
  const exitPreview = () => {
    setPreview(null);
    setResult(null);
    setError("");
  };
  if (!canRead)
    return (
      <main className="teacher-sub-content">
        <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>
      </main>
    );
  return (
    <div className="teacher-sub-workspace teacher-sub-workspace--page teacher-weplay-workspace">
      <TeacherSubNavigation
        title="위플레이 관리"
        activeLabel={game.name}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        {WEPLAY_GAMES.map((item) => (
          <Link
            key={item.id}
            to={`/teacher/weplay?game=${item.id}`}
            className={`teacher-settings-section${item.id === game.id ? " is-active" : ""}`}
            aria-current={item.id === game.id ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            title={item.name}
          >
            <TeacherNavigationIcon name="game" />
            <span>{item.name}</span>
          </Link>
        ))}
      </TeacherSubNavigation>
      <main className="teacher-sub-content teacher-weplay-content">
        <div className="teacher-weplay-title">
          <h1>{game.name}</h1>
          {canReadPoints(userData, currentUser?.email) && (
            <Link
              className="teacher-weplay-button"
              to="/teacher/points?tab=policy&section=policy-weplay"
            >
              위스 설정
            </Link>
          )}
        </div>
        {loading ? (
          <p role="status">게임 정보를 불러오는 중입니다.</p>
        ) : !data || !draft ? (
          <>
            <p role="alert" className="teacher-weplay-error">
              {error || "현재 학기를 확인해 주세요."}
            </p>
            <button
              className="teacher-weplay-button"
              onClick={() => void load()}
            >
              다시 불러오기
            </button>
          </>
        ) : (
          <>
            {error && (
              <p role="alert" className="teacher-weplay-error">
                {error}
              </p>
            )}
            {reloadRequired && (
              <button
                className="teacher-weplay-button"
                onClick={() => void load()}
              >
                최신 설정 불러오기
              </button>
            )}
            {preview ? (
              <section
                className="teacher-weplay-preview"
                aria-label="교사 게임 체험"
              >
                <div className="teacher-weplay-section-title">
                  <h2>교사 체험</h2>
                  <button
                    className="teacher-weplay-button"
                    onClick={exitPreview}
                  >
                    {result ? "관리로 돌아가기" : "체험 종료"}
                  </button>
                </div>
                <div className="weplay-page">
                  {result ? (
                    <div className="weplay-panel">
                      <h2>
                        체험 결과 ·{" "}
                        {WEPLAY_DIFFICULTY_LABELS[result.difficulty]}
                      </h2>
                      <p className="weplay-result">
                        <strong>
                          {result.correctCount} / {result.totalWords}개
                        </strong>
                        <span>{result.score.toLocaleString()}점</span>
                      </p>
                      <p>위스·랭킹·학생 기록에 반영되지 않습니다.</p>
                      {result.missedWords.length > 0 && (
                        <details>
                          <summary>놓친 단어</summary>
                          <p>
                            {[
                              ...new Set(
                                result.missedWords.map((word) => word.text),
                              ),
                            ].join(" · ")}
                          </p>
                        </details>
                      )}
                      <button
                        className="weplay-primary"
                        disabled={starting}
                        onClick={() => void startPreview()}
                      >
                        {starting ? "준비 중…" : "다시 체험"}
                      </button>
                    </div>
                  ) : (
                    <HistoryRainGame
                      key={preview.session.id}
                      session={preview.session}
                      config={config}
                      transport={preview.transport}
                      preview
                      onComplete={setResult}
                    />
                  )}
                </div>
              </section>
            ) : (
              <>
                {!canWrite && (
                  <p className="teacher-weplay-notice">
                    읽기 전용입니다. 게임 체험은 이용할 수 있습니다.
                  </p>
                )}
                <form onSubmit={(event) => void save(event)}>
                  <section
                    className="teacher-weplay-section"
                    aria-labelledby="weplay-settings-title"
                  >
                    <div className="teacher-weplay-section-title">
                      <h2 id="weplay-settings-title">게임 운영</h2>
                      <div className="teacher-weplay-actions">
                        <span role="status">
                          {feedback ||
                            (dirty
                              ? "저장하지 않은 변경 사항"
                              : "저장된 설정과 동일")}
                        </span>
                        {canWrite && (
                          <button
                            className="teacher-weplay-button is-primary"
                            type="submit"
                            disabled={!dirty || saving}
                          >
                            {saving ? "저장 중…" : "게임 설정 저장"}
                          </button>
                        )}
                      </div>
                    </div>
                    <label className="teacher-weplay-toggle">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        disabled={!canWrite || saving}
                        onChange={(event) =>
                          update({ enabled: event.target.checked })
                        }
                      />
                      학생 게임 사용 허용
                    </label>
                    <p className="teacher-weplay-note">
                      끄면 새 연습·도전을 시작할 수 없습니다. 진행 중인 판은
                      끝까지 진행됩니다.
                    </p>
                    <fieldset
                      className="teacher-weplay-sources"
                      disabled={!canWrite || saving}
                    >
                      <legend>출제 자료</legend>
                      <label>
                        <input
                          type="radio"
                          name="weplay-source-mode"
                          checked={draft.sourceMode === "all"}
                          onChange={() =>
                            update({ sourceMode: "all", unitIds: [] })
                          }
                        />
                        전체 수업 자료
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="weplay-source-mode"
                          checked={draft.sourceMode === "selected"}
                          onChange={() => update({ sourceMode: "selected" })}
                        />
                        선택한 수업 자료
                      </label>
                    </fieldset>
                    <p className="teacher-weplay-note">
                      학생에게는 공개된 자료만 출제됩니다. 비공개 자료는 교사
                      체험에서만 사용할 수 있습니다.
                    </p>
                    {removedSourceCount > 0 && (
                      <p className="teacher-weplay-notice">
                        삭제된 자료 {removedSourceCount}개를 선택 목록에서
                        제외했습니다. 게임 설정을 저장하면 적용됩니다.
                      </p>
                    )}
                    <div className="teacher-weplay-counts">
                      <span>
                        학생 출제 가능 <strong>{availableCount}개</strong>
                      </span>
                      <span>
                        교사 체험 <strong>{previewCount}개</strong>
                      </span>
                    </div>
                    {availableCount < 3 && (
                      <p className="teacher-weplay-notice">
                        학생이 게임을 시작하려면 공개된 자료에 서로 다른 빈칸
                        정답이 3개 이상 필요합니다.
                      </p>
                    )}
                    {!data.lessons.length ? (
                      <p>
                        등록된 수업 자료가 없습니다.{" "}
                        <Link to="/teacher/lesson">수업 자료 관리</Link>
                      </p>
                    ) : (
                      <ul className="teacher-weplay-lessons">
                        {data.lessons.map((item) => (
                          <li key={item.unitId}>
                            <div className="teacher-weplay-lesson-row">
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${item.title || "제목 없는 수업 자료"} 출제 포함`}
                                  checked={
                                    draft.sourceMode === "all" ||
                                    draft.unitIds.includes(item.unitId)
                                  }
                                  disabled={
                                    draft.sourceMode === "all" ||
                                    !canWrite ||
                                    saving
                                  }
                                  onChange={(event) =>
                                    update({
                                      unitIds: event.target.checked
                                        ? [...draft.unitIds, item.unitId]
                                        : draft.unitIds.filter(
                                            (id) => id !== item.unitId,
                                          ),
                                    })
                                  }
                                />
                                <span>
                                  {item.title || "제목 없는 수업 자료"}
                                </span>
                              </label>
                              <span className="teacher-weplay-note">
                                {item.isVisibleToStudents ? "공개" : "비공개"}
                              </span>
                            </div>
                            <details>
                              <summary>빈칸 단어 {item.wordCount}개</summary>
                              <p>
                                {item.words.length
                                  ? item.words.join(" · ")
                                  : "게임에 사용할 빈칸 정답이 없습니다."}
                              </p>
                            </details>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </form>
                <section
                  className="teacher-weplay-section"
                  aria-labelledby="weplay-preview-title"
                >
                  <div className="teacher-weplay-section-title">
                    <h2 id="weplay-preview-title">교사 체험</h2>
                    <span className="teacher-weplay-note">
                      60초 · 20개 단어
                    </span>
                  </div>
                  <div
                    className="teacher-weplay-difficulty"
                    role="group"
                    aria-label="체험 난이도"
                  >
                    {(
                      Object.keys(
                        WEPLAY_DIFFICULTY_LABELS,
                      ) as WeplayDifficulty[]
                    ).map((level) => (
                      <button
                        key={level}
                        className="teacher-weplay-button"
                        aria-pressed={difficulty === level}
                        disabled={starting}
                        onClick={() => setDifficulty(level)}
                      >
                        {WEPLAY_DIFFICULTY_LABELS[level]}
                      </button>
                    ))}
                  </div>
                  <p className="teacher-weplay-note">
                    위스·랭킹·학생 기록에 반영되지 않습니다.
                    {dirty && " 선택한 자료로 먼저 체험할 수 있습니다."}
                  </p>
                  {previewCount < 3 && (
                    <p className="teacher-weplay-notice">
                      체험할 자료에 서로 다른 빈칸 정답이 3개 이상 필요합니다.
                    </p>
                  )}
                  <button
                    className="teacher-weplay-button is-primary"
                    disabled={starting || saving || previewCount < 3}
                    onClick={() => void startPreview()}
                  >
                    {starting ? "준비 중…" : "체험 시작"}
                  </button>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
