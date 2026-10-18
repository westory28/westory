import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import WeplayGameCatalog from "../../components/common/weplay/WeplayGameCatalog";
import WeplayLaunchPanel from "../../components/common/weplay/WeplayLaunchPanel";
import { useAuth } from "../../contexts/AuthContext";
import {
  WEPLAY_GAMES,
  getWeplayLobby,
  startWeplayGame,
  weplayErrorMessage,
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayDifficulty,
  type WeplayLobby,
  type WeplayResult,
  type WeplaySession,
} from "../../lib/weplay";
import HistoryRainGame from "./weplay/HistoryRainGame";
import NavalBattleResult from "../../components/common/weplay/NavalBattleResult";
import WeplayGuide from "../../components/common/weplay/WeplayGuide";
import useWeplayGuide from "../../components/common/weplay/useWeplayGuide";
import useWeplayMusic from "../../components/common/weplay/useWeplayMusic";
import WeplayMusicButton from "../../components/common/weplay/WeplayMusicButton";
import { getWeplayGameTitle } from "../../lib/weplayTitle";
import { notifyPointsUpdated } from "../../lib/appEvents";
import { preloadWeplayAssets } from "../../lib/weplayAssets";
import WeplayLobbyIcon from "./weplay/WeplayLobbyIcon";
import WeplayRecordsDialog, {
  type WeplayRecordsView,
} from "./weplay/WeplayRecordsDialog";
import "./weplay/weplay.css";
import "./weplay/lobby.css";

import YutGameEntry from "../../components/common/weplay/YutGameEntry";
import WeplayStudioIntro from "../../components/common/weplay/WeplayStudioIntro";
import WeplayGameFrame from "../../components/common/weplay/WeplayGameFrame";
import { withWeplayRequestTimeout } from "../../components/common/weplay/requestTimeout";

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export default function Weplay() {
  const [params] = useSearchParams();
  return params.get("game") === "joseon-yut" ? (
    <YutGameEntry portal="student" />
  ) : (
    <NavalWeplay />
  );
}

function NavalWeplay() {
  const { config, currentUser, userData, menuConfig } = useAuth();
  const [params, setParams] = useSearchParams();
  const [introComplete, setIntroComplete] = useState(false);
  useEffect(() => {
    if (params.get("game") !== "history-rain") setIntroComplete(false);
  }, [params.get("game")]);
  const selectedGame = WEPLAY_GAMES.find(
    (game) => game.id === params.get("game"),
  );
  const gameTitle = getWeplayGameTitle(menuConfig);
  const music = useWeplayMusic(!!selectedGame);
  const [lobby, setLobby] = useState<WeplayLobby | null>(null);
  const [session, setSession] = useState<WeplaySession | null>(null);
  const [result, setResult] = useState<WeplayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"practice" | "challenge">("practice");
  const [difficulty, setDifficulty] = useState<WeplayDifficulty>("mild");
  const [rankingDifficulty, setRankingDifficulty] =
    useState<WeplayDifficulty>("mild");
  const [recordsView, setRecordsView] = useState<WeplayRecordsView | null>(
    null,
  );
  const requestKey = useRef("");
  const startPayload = useRef<{
    mode: "practice" | "challenge";
    difficulty: WeplayDifficulty;
    requestKey: string;
  } | null>(null);
  const uncertainStart = useRef(false);
  const generation = useRef(0);
  const loadRequest = useRef<{ scope: string; token: number } | null>(null);
  const startGeneration = useRef(0);
  const startingRef = useRef(false);
  const scope = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}`;
  const [loadedScope, setLoadedScope] = useState("");
  const guide = useWeplayGuide(
    currentUser?.uid,
    userData,
    !!selectedGame &&
      introComplete &&
      loadedScope === scope &&
      !!lobby &&
      !loading &&
      !starting &&
      !session &&
      !result,
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const load = useCallback(
    async (restore = true) => {
      if (loadRequest.current?.scope === scope) return;
      const request = ++generation.current;
      loadRequest.current = { scope, token: request };
      setLoading(true);
      setError("");
      try {
        const next = await withWeplayRequestTimeout(getWeplayLobby(config));
        if (request !== generation.current || scopeRef.current !== scope)
          return;
        setLobby(next);
        setLoadedScope(scope);
        if (restore && next.activeSession) {
          setIntroComplete(true);
          uncertainStart.current = false;
          startPayload.current = null;
          requestKey.current = "";
          setSession(next.activeSession);
          setMode(next.activeSession.mode);
          setDifficulty(next.activeSession.difficulty);
          setRankingDifficulty(next.activeSession.difficulty);
        }
      } catch (caught) {
        if (request === generation.current && scopeRef.current === scope)
          setError(
            weplayErrorMessage(
              caught,
              "위플레이를 불러오지 못했습니다. 다시 시도해 주세요.",
            ),
          );
      } finally {
        if (loadRequest.current?.token === request) loadRequest.current = null;
        if (request === generation.current && scopeRef.current === scope)
          setLoading(false);
      }
    },
    [config?.year, config?.semester, currentUser?.uid],
  );
  useEffect(() => {
    preloadWeplayAssets();
    setSession(null);
    setResult(null);
    setLobby(null);
    setRecordsView(null);
    setStarting(false);
    startingRef.current = false;
    startGeneration.current++;
    requestKey.current = "";
    startPayload.current = null;
    uncertainStart.current = false;
    if (config && currentUser) void load();
    return () => {
      generation.current += 1;
      loadRequest.current = null;
      startGeneration.current++;
      startingRef.current = false;
    };
  }, [load]);
  useEffect(() => {
    setRecordsView(null);
    if (
      selectedGame &&
      loadedScope === scope &&
      lobby?.activeSession &&
      !result &&
      !session
    ) {
      setSession(lobby.activeSession);
    }
  }, [selectedGame?.id]);
  // A running paid session stays visible when browser history returns to the catalogue.
  useEffect(() => {
    if (session && !selectedGame) {
      setParams({ game: WEPLAY_GAMES[0].id }, { replace: true });
    }
  }, [session, selectedGame?.id, setParams]);
  const start = async () => {
    if (
      startingRef.current ||
      starting ||
      !lobby ||
      lobby.gameEnabled === false
    )
      return;
    startingRef.current = true;
    const request = ++startGeneration.current;
    music.start();
    preloadWeplayAssets(true);
    const startedScope = scope;
    const isCurrent = () =>
      scopeRef.current === startedScope && startGeneration.current === request;
    setStarting(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    if (startPayload.current?.requestKey !== requestKey.current) {
      startPayload.current = {
        mode,
        difficulty,
        requestKey: requestKey.current,
      };
    }
    uncertainStart.current = true;
    try {
      const next = await withWeplayRequestTimeout(
        startWeplayGame(config, startPayload.current),
      );
      if (!isCurrent()) return;
      uncertainStart.current = false;
      startPayload.current = null;
      if (next.mode === "challenge") notifyPointsUpdated();
      if (next.status === "finished" && next.result) setResult(next.result);
      else setSession(next);
      requestKey.current = "";
    } catch (caught) {
      const code = String((caught as { code?: string })?.code || "");
      if (
        isCurrent() &&
        /invalid-argument|failed-precondition|permission-denied|unauthenticated|resource-exhausted|aborted|not-found/.test(
          code,
        )
      ) {
        uncertainStart.current = false;
      }
      if (
        String((caught as { code?: string })?.code || "").includes(
          "already-exists",
        ) &&
        isCurrent()
      ) {
        await load();
        return;
      }
      if (isCurrent())
        setError(
          uncertainStart.current
            ? "게임 시작 여부를 확인하지 못했습니다. 같은 설정으로 다시 시작을 눌러 확인해 주세요."
            : weplayErrorMessage(
                caught,
                "게임을 시작하지 못했습니다. 다시 시도해 주세요.",
              ),
        );
    } finally {
      if (isCurrent()) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  };
  const complete = (next: WeplayResult) => {
    if (next.mode === "challenge") notifyPointsUpdated();
    setMode(next.mode);
    setDifficulty(next.difficulty);
    setRankingDifficulty(next.difficulty);
    setResult(next);
    setSession(null);
    setLobby((previous) =>
      previous ? { ...previous, activeSession: null } : previous,
    );
    void load(false);
  };
  const cannotChallenge =
    !!lobby &&
    (!lobby.policy.enabled ||
      lobby.dailyRemaining <= 0 ||
      lobby.balance < lobby.policy.challengeCost);
  const returnToLobby = () => {
    setResult(null);
    setRecordsView(null);
    setError("");
    requestKey.current = "";
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".weplay-mode-choice button[aria-pressed='true']",
        )
        ?.focus();
    });
  };
  const availableCount =
    (mode === "challenge"
      ? lobby?.challengeWordCountsByDifficulty?.[difficulty]
      : lobby?.wordCountsByDifficulty?.[difficulty]) ??
    lobby?.wordCount ??
    0;
  const launchIssue = !lobby
    ? ""
    : lobby.gameEnabled === false
      ? "지금은 게임을 쉬고 있습니다."
      : availableCount < 3
        ? "출제할 빈칸 정답이 3개 이상 필요합니다."
        : mode !== "challenge"
          ? ""
          : !lobby.policy.enabled
            ? "지금은 연습 게임을 이용할 수 있습니다."
            : lobby.dailyRemaining <= 0
              ? "오늘의 도전을 모두 마쳤습니다."
              : lobby.balance < lobby.policy.challengeCost
                ? "도전에 필요한 위스가 부족합니다."
                : "";
  if (!selectedGame && !session) {
    return (
      <main className="weplay-page">
        <WeplayGameCatalog gameTitle={gameTitle} portal="student" />
      </main>
    );
  }
  return (
    <main className="weplay-page weplay-game-page" tabIndex={-1}>
      <header className="weplay-heading">
        <div>
          <span>위플레이</span>
          <h1 tabIndex={-1}>{gameTitle}</h1>
        </div>
        <div className="weplay-heading-actions">
          {lobby && !session && (
            <div
              className="weplay-wis-badge"
              aria-label={`내 위스 ${lobby.balance.toLocaleString()}`}
            >
              <span className="weplay-wis-coin" aria-hidden="true">
                Ws
              </span>
              <span>내 위스</span>
              <strong>{lobby.balance.toLocaleString()}</strong>
            </div>
          )}
          <button
            type="button"
            className="weplay-guide-launch"
            onClick={guide.openGuide}
            disabled={!currentUser || starting || (!session && !introComplete)}
          >
            <WeplayLobbyIcon name="info" />
            게임 안내
          </button>
          <div className="weplay-game-navigation">
            {!session && !starting && (
              <Link
                className="weplay-catalog-back"
                to="/student/weplay"
                onClick={() => {
                  setResult(null);
                  setRecordsView(null);
                }}
              >
                전체 게임
              </Link>
            )}
            <WeplayMusicButton {...music} />
          </div>
        </div>
      </header>
      <WeplayGameFrame
        busy={starting || (loading && !lobby && introComplete)}
        label={
          starting ? "출항을 준비하고 있습니다" : "게임을 불러오고 있습니다"
        }
      >
        {!session && !introComplete ? (
          <WeplayStudioIntro onComplete={() => setIntroComplete(true)} />
        ) : session ? (
          <HistoryRainGame
            key={session.id}
            session={session}
            config={config}
            onComplete={complete}
            onShowGuide={guide.openGuide}
            gameTitle={gameTitle}
          />
        ) : (
          <>
            {loading && !lobby && (
              <p role="status">게임을 준비하고 있습니다.</p>
            )}
            {error && (
              <div className="weplay-error" role="alert">
                <p>{error}</p>
                {!lobby && (
                  <button type="button" onClick={() => void load()}>
                    다시 불러오기
                  </button>
                )}
              </div>
            )}
            {result?.battle ? (
              <NavalBattleResult
                result={result}
                gameTitle={gameTitle}
                onReplay={returnToLobby}
                onLobby={returnToLobby}
              />
            ) : (
              result && (
                <section className="weplay-panel" aria-label="게임 결과">
                  <h2>
                    이번 기록 · {WEPLAY_DIFFICULTY_LABELS[result.difficulty]}
                  </h2>
                  <div className="weplay-result">
                    <strong>
                      {result.correctCount} / {result.totalWords}개
                    </strong>
                    <span>{result.score.toLocaleString()}점</span>
                    <strong>
                      {result.mode === "practice"
                        ? "연습 · 위스 변동 없음"
                        : `${signed(result.netWis)}위스`}
                    </strong>
                  </div>
                  {result.battle && (
                    <p className="weplay-battle-summary">
                      <strong>
                        {result.battle.outcome === "defeat"
                          ? "함선 침몰"
                          : "해역 방어 완료"}
                      </strong>
                      <span>적선 {result.battle.sunkShips}척 격침</span>
                      <span>
                        화포 {result.battle.cannonShots}회 · 필살기{" "}
                        {result.battle.specialCount}회
                      </span>
                    </p>
                  )}
                  {result.mode === "challenge" && (
                    <p>
                      도전 비용 {result.cost}위스 · 결과 지급 {result.reward}
                      위스
                    </p>
                  )}
                  {result.missedWords.length > 0 && (
                    <details>
                      <summary>놓친 단어 {result.missedWords.length}개</summary>
                      <ul className="weplay-missed">
                        {result.missedWords.map((word) => (
                          <li key={word.id}>
                            <strong>{word.text}</strong>
                            <span>{word.context || word.lessonTitle}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    type="button"
                    onClick={returnToLobby}
                    className="weplay-primary"
                  >
                    게임 메인으로
                  </button>
                </section>
              )
            )}
            {lobby && (
              <nav className="weplay-lobby-actions" aria-label="게임 기록">
                <button
                  type="button"
                  disabled={starting}
                  aria-haspopup="dialog"
                  onClick={() => setRecordsView("ranking")}
                >
                  <WeplayLobbyIcon name="ranking" />
                  우리 반 랭킹
                </button>
                <button
                  type="button"
                  disabled={starting}
                  aria-haspopup="dialog"
                  onClick={() => setRecordsView("history")}
                >
                  <WeplayLobbyIcon name="history" />내 기록
                </button>
              </nav>
            )}
            {lobby && !result && (
              <WeplayLaunchPanel
                mode={mode}
                difficulty={difficulty}
                starting={starting}
                disabled={
                  loading ||
                  lobby.gameEnabled === false ||
                  availableCount < 3 ||
                  (mode === "challenge" && cannotChallenge)
                }
                launchIssue={launchIssue}
                challengeCost={lobby.policy.challengeCost}
                onModeChange={(value) => {
                  if (startingRef.current || uncertainStart.current) return;
                  setMode(value);
                  requestKey.current = "";
                }}
                onDifficultyChange={(value) => {
                  if (startingRef.current || uncertainStart.current) return;
                  setDifficulty(value);
                  setRankingDifficulty(value);
                  requestKey.current = "";
                }}
                onStart={() => void start()}
              />
            )}
            {lobby && recordsView && (
              <WeplayRecordsDialog
                view={recordsView}
                lobby={lobby}
                difficulty={rankingDifficulty}
                onDifficultyChange={setRankingDifficulty}
                onClose={() => setRecordsView(null)}
              />
            )}
          </>
        )}
      </WeplayGameFrame>
      <WeplayGuide
        gameTitle={gameTitle}
        open={guide.open && (introComplete || !!session)}
        saving={guide.saving}
        error={guide.error}
        gameRunning={!!session}
        rules={lobby}
        onFinish={() => void guide.finishGuide()}
        onCloseForNow={guide.closeForNow}
      />
    </main>
  );
}
