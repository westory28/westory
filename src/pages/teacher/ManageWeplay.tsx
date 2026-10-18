import PortalWorkspace from "../../components/common/PortalWorkspace";
import { InfoHelpIcon } from "../../components/common/InfoHelp";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../lib/permissions";
import {
  getWeplayManagement,
  saveWeplayGameSettings,
  previewWeplayGame,
  normalizeWeplayAnswer,
  normalizeWeplayGameSettings,
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
import WeplayGameCatalog from "../../components/common/weplay/WeplayGameCatalog";
import WeplayLaunchPanel from "../../components/common/weplay/WeplayLaunchPanel";
import NavalBattleResult from "../../components/common/weplay/NavalBattleResult";
import WeplayGuide from "../../components/common/weplay/WeplayGuide";
import useWeplayGuide from "../../components/common/weplay/useWeplayGuide";
import useWeplayMusic from "../../components/common/weplay/useWeplayMusic";
import WeplayMusicButton from "../../components/common/weplay/WeplayMusicButton";
import "../../components/common/weplay/weplay.css";
import "./ManageWeplay.css";
import WeplayWordPool, { getWeplayWordPool } from "./components/WeplayWordPool";
import WeplayDifficultyEditor from "./components/WeplayDifficultyEditor";
import WeplayTitleEditor from "./components/WeplayTitleEditor";
import { getWeplayGameTitle } from "../../lib/weplayTitle";

import YutManagement from "./components/YutManagement";
import WeplayStudioIntro from "../../components/common/weplay/WeplayStudioIntro";
import { prepareWeplayIntroAudio } from "../../components/common/weplay/weplayIntroAudio";

export default function ManageWeplay() {
  const [params] = useSearchParams();
  const { userData, currentUser } = useAuth();
  if (params.get("game") === "joseon-yut") {
    if (!canReadLessonManagement(userData, currentUser?.email)) {
      return <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>;
    }
    return <YutManagement />;
  }
  return <NavalWeplayManagement />;
}

function NavalWeplayManagement() {
  const { config, currentUser, userData, menuConfig } = useAuth();
  const gameTitle = getWeplayGameTitle(menuConfig);
  const [params, setParams] = useSearchParams();
  const selectedGame = WEPLAY_GAMES.find(
    (item) => item.id === params.get("game"),
  );
  const game = selectedGame || WEPLAY_GAMES[0];
  const music = useWeplayMusic(!!selectedGame);
  const previewView = !!selectedGame && params.get("view") === "preview";
  const [introComplete, setIntroComplete] = useState(false);
  useEffect(() => {
    if (!previewView) setIntroComplete(false);
  }, [previewView]);
  const viewKey = selectedGame ? `${game.id}/${previewView}` : "catalog";
  const previousView = useRef(viewKey);
  const mainRef = useRef<HTMLElement>(null);
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
  const [difficultyError, setDifficultyError] = useState("");
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [mode, setMode] = useState<WeplaySession["mode"]>("practice");
  const [difficulty, setDifficulty] = useState<WeplayDifficulty>("mild");
  const [preview, setPreview] = useState<{
    session: WeplaySession;
    transport: HistoryRainTransport;
  } | null>(null);
  const [result, setResult] = useState<WeplayResult | null>(null);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const previewViewRef = useRef(previewView);
  previewViewRef.current = previewView;
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}/${game.id}/${canRead}/${canWrite}`;
  const [loadedScope, setLoadedScope] = useState("");
  const guide = useWeplayGuide(
    currentUser?.uid,
    userData,
    !!selectedGame &&
      (!previewView || introComplete) &&
      loadedScope === scope &&
      canRead &&
      !!data &&
      !loading &&
      !starting &&
      !preview &&
      !result,
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dirty =
    !!draft &&
    !!data &&
    (!!difficultyError ||
      JSON.stringify(draft) !== JSON.stringify(data.settings));
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    setReloadRequired(false);
    try {
      const response = await getWeplayManagement(config, game.id);
      if (token !== generation.current || scopeRef.current !== scope) return;
      response.settings = normalizeWeplayGameSettings(response.settings);
      setData(response);
      setLoadedScope(scope);
      setDifficultyError("");
      setSettingsRevision((value) => value + 1);
      const knownUnits = new Set(response.lessons.map((item) => item.unitId));
      const unitIds = response.settings.unitIds.filter((id) =>
        knownUnits.has(id),
      );
      setRemovedSourceCount(response.settings.unitIds.length - unitIds.length);
      setDraft({ ...response.settings, unitIds });
    } catch (caught) {
      if (token === generation.current && scopeRef.current === scope)
        setError(
          weplayErrorMessage(
            caught,
            "게임 정보를 불러오지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (token === generation.current && scopeRef.current === scope)
        setLoading(false);
    }
  }, [
    config?.year,
    config?.semester,
    currentUser?.uid,
    game.id,
    canRead,
    canWrite,
  ]);
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
      previewGeneration.current++;
    };
  }, [load, canRead]);
  useEffect(() => {
    if (previewView) return;
    previewGeneration.current++;
    setPreview(null);
    setResult(null);
    setStarting(false);
  }, [previewView]);
  useEffect(() => {
    if (previousView.current !== viewKey) {
      mainRef.current?.focus({ preventScroll: true });
      previousView.current = viewKey;
    }
  }, [viewKey]);
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
  const pool = draft ? getWeplayWordPool(data?.lessons || [], draft) : [];
  const includedWords = pool.filter(
    (word) => !draft?.excludedWords.includes(word.key),
  );
  const countWords = (publicOnly: boolean, level?: WeplayDifficulty) =>
    includedWords.filter((word) => {
      const rule = level && draft?.difficulties[level];
      const length = Array.from(normalizeWeplayAnswer(word.text)).length;
      return (
        (!publicOnly || word.public) &&
        (!rule ||
          (length >= rule.minWordLength && length <= rule.maxWordLength))
      );
    }).length;
  const previewCount = countWords(false, difficulty);
  const availableCount = countWords(true);
  const update = (next: Partial<WeplayGameSettings>) => {
    setDraft((previous) => (previous ? { ...previous, ...next } : previous));
    setFeedback("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !draft ||
      !canWrite ||
      loadedScope !== scope ||
      saving ||
      !dirty ||
      difficultyError
    )
      return;
    const requestedScope = scope;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await saveWeplayGameSettings(config, game.id, draft);
      if (scopeRef.current !== requestedScope) return;
      response.settings = normalizeWeplayGameSettings(response.settings);
      setData(response);
      setDraft(response.settings);
      setDifficultyError("");
      setSettingsRevision((value) => value + 1);
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
    if (
      !canRead ||
      !previewView ||
      loadedScope !== scope ||
      starting ||
      saving ||
      previewCount < 3 ||
      !draft ||
      difficultyError
    )
      return;
    music.start();
    const requestedScope = scope;
    const request = ++previewGeneration.current;
    setStarting(true);
    setError("");
    try {
      const session = await previewWeplayGame(
        config,
        game.id,
        difficulty,
        selectedLessons.map((item) => item.unitId),
        draft,
      );
      if (
        scopeRef.current !== requestedScope ||
        !previewViewRef.current ||
        previewGeneration.current !== request
      )
        return;
      setResult(null);
      setPreview({ session, transport: createWeplayPreviewTransport(session) });
    } catch (caught) {
      if (
        scopeRef.current === requestedScope &&
        previewViewRef.current &&
        previewGeneration.current === request
      )
        setError(
          weplayErrorMessage(
            caught,
            "체험을 시작하지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (
        scopeRef.current === requestedScope &&
        previewViewRef.current &&
        previewGeneration.current === request
      )
        setStarting(false);
    }
  };
  const exitPreview = () => {
    previewGeneration.current++;
    setPreview(null);
    setResult(null);
    setStarting(false);
    setError("");
  };
  if (!canRead)
    return (
      <main className="teacher-sub-content">
        <p role="alert">위플레이 관리 화면을 볼 권한이 없습니다.</p>
      </main>
    );
  return (
    <PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--page teacher-weplay-workspace">
      <main
        ref={mainRef}
        tabIndex={-1}
        className="teacher-sub-content teacher-weplay-content"
      >
        {!selectedGame && (
          <WeplayGameCatalog portal="teacher" gameTitle={gameTitle} />
        )}
        <div hidden={!selectedGame}>
          <div className="teacher-weplay-title ws-page-header">
            <div className="teacher-weplay-heading">
              <h1 tabIndex={-1}>{gameTitle}</h1>
              <button
                type="button"
                className="weplay-guide-launch"
                onClick={guide.openGuide}
                disabled={
                  !currentUser || starting || (previewView && !introComplete)
                }
              >
                <InfoHelpIcon />
                게임 안내
              </button>
            </div>
            <div className="teacher-weplay-header-actions">
              <nav
                className="teacher-weplay-navigation"
                aria-label="위플레이 화면 이동"
              >
                <Link className="teacher-weplay-button" to="/teacher/weplay">
                  전체 게임
                </Link>
                {previewView && (
                  <Link
                    className="teacher-weplay-button"
                    to={`/teacher/weplay?game=${game.id}`}
                  >
                    게임 관리
                  </Link>
                )}
              </nav>
              <WeplayMusicButton {...music} />
            </div>
          </div>
          {loading || (data && loadedScope !== scope) ? (
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
              {previewView && (
                <section
                  className="teacher-weplay-preview"
                  aria-label="교사 게임 체험"
                >
                  {introComplete && (
                    <div className="teacher-weplay-section-title">
                      <h2>{preview ? "교사 체험" : "대기 화면 미리보기"}</h2>
                      {preview && (
                        <button
                          className="teacher-weplay-button"
                          disabled={starting}
                          onClick={exitPreview}
                        >
                          {result ? "대기 화면" : "체험 종료"}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="weplay-page">
                    {!introComplete ? (
                      <WeplayStudioIntro
                        onComplete={() => setIntroComplete(true)}
                      />
                    ) : !preview ? (
                      <WeplayLaunchPanel
                        mode={mode}
                        difficulty={difficulty}
                        starting={starting}
                        disabled={
                          saving || previewCount < 3 || !!difficultyError
                        }
                        launchIssue={
                          difficultyError ||
                          (previewCount < 3
                            ? "선택한 난이도의 단어 길이에 맞는 단어가 3개 이상 필요합니다."
                            : "")
                        }
                        challengeCost={0}
                        preview
                        onModeChange={setMode}
                        onDifficultyChange={setDifficulty}
                        onStart={() => void startPreview()}
                      />
                    ) : result?.battle ? (
                      <NavalBattleResult
                        gameTitle={gameTitle}
                        result={result}
                        preview
                        replaying={starting}
                        onReplay={exitPreview}
                      />
                    ) : result ? (
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
                        {result.battle && (
                          <p>
                            {result.battle.outcome === "defeat"
                              ? "함선 침몰"
                              : "해역 방어 완료"}
                            {" · "}적선 {result.battle.sunkShips}척 격침 ·
                            필살기 {result.battle.specialCount}회
                          </p>
                        )}
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
                          onClick={exitPreview}
                        >
                          {starting ? "준비 중…" : "다시 체험"}
                        </button>
                      </div>
                    ) : (
                      <HistoryRainGame
                        gameTitle={gameTitle}
                        onShowGuide={guide.openGuide}
                        key={preview.session.id}
                        session={preview.session}
                        config={config}
                        transport={preview.transport}
                        preview
                        onComplete={setResult}
                      />
                    )}
                  </div>
                  {introComplete && !preview && dirty && (
                    <p className="teacher-weplay-note">
                      저장 전 설정으로 체험합니다.
                    </p>
                  )}
                </section>
              )}
              <div hidden={previewView}>
                {!canWrite && (
                  <p className="teacher-weplay-notice">
                    읽기 전용입니다. 게임 체험은 이용할 수 있습니다.
                  </p>
                )}
                <div className="teacher-weplay-management">
                  <div className="teacher-weplay-section teacher-weplay-settings-column ws-surface">
                    <WeplayTitleEditor title={gameTitle} />
                    <form noValidate onSubmit={(event) => void save(event)}>
                      <section
                        className="teacher-weplay-settings"
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
                                disabled={!dirty || saving || !!difficultyError}
                              >
                                {saving ? "저장 중…" : "게임 설정 저장"}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="teacher-weplay-operation-row">
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
                          <div className="teacher-weplay-counts">
                            <span>
                              학생 출제 가능 <strong>{availableCount}개</strong>
                            </span>
                            <span>
                              교사 체험 <strong>{countWords(false)}개</strong>
                            </span>
                          </div>
                        </div>
                        {removedSourceCount > 0 && (
                          <p className="teacher-weplay-notice">
                            삭제된 자료 {removedSourceCount}개를 선택 목록에서
                            제외했습니다. 게임 설정을 저장하면 적용됩니다.
                          </p>
                        )}
                        <WeplayWordPool
                          lessons={data.lessons}
                          settings={draft}
                          disabled={!canWrite || saving}
                          update={update}
                        />
                        <WeplayDifficultyEditor
                          key={`${scope}/${settingsRevision}`}
                          settings={draft}
                          disabled={!canWrite || saving}
                          update={update}
                          onValidityChange={setDifficultyError}
                        />
                      </section>
                    </form>
                  </div>
                  <section
                    className="teacher-weplay-section teacher-weplay-preview-controls ws-surface"
                    aria-labelledby="weplay-preview-title"
                  >
                    <div className="teacher-weplay-preview-toolbar">
                      <h2 id="weplay-preview-title">교사 체험</h2>
                      <button
                        className="teacher-weplay-button is-primary"
                        disabled={saving}
                        onClick={() => {
                          prepareWeplayIntroAudio();
                          setError("");
                          setParams({ game: game.id, view: "preview" });
                        }}
                      >
                        체험하기
                      </button>
                    </div>
                    <img
                      className="teacher-weplay-preview-art"
                      src={`${import.meta.env.BASE_URL}assets/weplay/naval/lobby-turtle-ship.webp`}
                      alt=""
                      width={1200}
                      height={900}
                    />
                    <p className="teacher-weplay-note">
                      위스·랭킹·학생 기록에 반영되지 않습니다.
                      {dirty && " 저장 전 설정으로 체험합니다."}
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
          <WeplayGuide
            gameTitle={gameTitle}
            open={
              !!selectedGame && (!previewView || introComplete) && guide.open
            }
            saving={guide.saving}
            error={guide.error}
            gameRunning={!!preview}
            onFinish={() => void guide.finishGuide()}
            onCloseForNow={guide.closeForNow}
          />
        </div>
      </main>
    </PortalWorkspace>
  );
}
