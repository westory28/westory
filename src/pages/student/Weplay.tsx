import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
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

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
export default function Weplay() {
  const { config, currentUser, userData, menuConfig } = useAuth();
  const gameTitle = getWeplayGameTitle(menuConfig);
  const music = useWeplayMusic();
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
  const generation = useRef(0);
  const scope = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}`;
  const [loadedScope, setLoadedScope] = useState("");
  const guide = useWeplayGuide(
    currentUser?.uid,
    userData,
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
      const request = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const next = await getWeplayLobby(config);
        if (request !== generation.current) return;
        setLobby(next);
        setLoadedScope(scope);
        if (restore && next.activeSession) {
          setSession(next.activeSession);
          setMode(next.activeSession.mode);
          setDifficulty(next.activeSession.difficulty);
          setRankingDifficulty(next.activeSession.difficulty);
        }
      } catch (caught) {
        if (request === generation.current)
          setError(
            weplayErrorMessage(
              caught,
              "위플레이를 불러오지 못했습니다. 다시 시도해 주세요.",
            ),
          );
      } finally {
        if (request === generation.current) setLoading(false);
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
    requestKey.current = "";
    if (config && currentUser) void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const start = async () => {
    if (starting || !lobby || lobby.gameEnabled === false) return;
    music.start();
    preloadWeplayAssets(true);
    const startedScope = scope;
    setStarting(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const next = await startWeplayGame(config, {
        mode,
        difficulty,
        requestKey: requestKey.current,
      });
      if (scopeRef.current !== startedScope) return;
      if (next.mode === "challenge") notifyPointsUpdated();
      if (next.status === "finished" && next.result) setResult(next.result);
      else setSession(next);
      requestKey.current = "";
    } catch (caught) {
      if (
        String((caught as { code?: string })?.code || "").includes(
          "already-exists",
        ) &&
        scopeRef.current === startedScope
      ) {
        await load();
        return;
      }
      if (scopeRef.current === startedScope)
        setError(
          weplayErrorMessage(
            caught,
            "게임을 시작하지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      if (scopeRef.current === startedScope) setStarting(false);
    }
  };
  const complete = (next: WeplayResult) => {
    if (next.mode === "challenge") notifyPointsUpdated();
    setMode(next.mode);
    setDifficulty(next.difficulty);
    setRankingDifficulty(next.difficulty);
    setResult(next);
    setSession(null);
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
  return (
    <main className="weplay-page">
      <header className="weplay-heading">
        <div>
          <span>위플레이</span>
          <h1>{gameTitle}</h1>
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
            disabled={!currentUser || starting}
          >
            <WeplayLobbyIcon name="info" />
            게임 안내
          </button>
          <WeplayMusicButton {...music} />
        </div>
      </header>
      {session ? (
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
          {loading && !lobby && <p role="status">게임을 준비하고 있습니다.</p>}
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
                    도전 비용 {result.cost}위스 · 결과 지급 {result.reward}위스
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
            <section
              className={`weplay-panel weplay-launch is-${mode}`}
              aria-label="게임 시작"
            >
              <div className="weplay-launch-art">
                <img
                  src={`${import.meta.env.BASE_URL}assets/weplay/naval/lobby-turtle-ship.webp`}
                  alt="목재 덮개와 쇠못, 낮은 용머리와 노를 갖춘 거북선 재현 일러스트"
                  width={1200}
                  height={900}
                />
              </div>
              <div className="weplay-launch-controls">
                <div
                  className="weplay-mode weplay-mode-choice"
                  role="group"
                  aria-label="게임 모드"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "practice"}
                    disabled={starting}
                    onClick={() => {
                      setMode("practice");
                      requestKey.current = "";
                    }}
                  >
                    <span className="weplay-choice-top">
                      <strong>연습하기</strong>
                      <span className="weplay-choice-mark" aria-hidden="true">
                        {mode === "practice" ? "✓" : ""}
                      </span>
                    </span>
                    <span className="weplay-choice-note">위스 변동 없음</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "challenge"}
                    className="weplay-challenge-choice"
                    disabled={starting}
                    onClick={() => {
                      setMode("challenge");
                      requestKey.current = "";
                    }}
                  >
                    <span className="weplay-choice-top">
                      <strong>도전하기</strong>
                      <span className="weplay-choice-mark" aria-hidden="true">
                        {mode === "challenge" ? "✓" : ""}
                      </span>
                    </span>
                    <span className="weplay-choice-note">위스 획득·차감</span>
                  </button>
                </div>
                <h2 className="weplay-selected-mode">난이도</h2>
                <div
                  className="weplay-mode weplay-difficulty"
                  role="group"
                  aria-label="난이도"
                >
                  {(
                    Object.keys(WEPLAY_DIFFICULTY_LABELS) as WeplayDifficulty[]
                  ).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={starting}
                      aria-pressed={difficulty === value}
                      onClick={() => {
                        setDifficulty(value);
                        setRankingDifficulty(value);
                        requestKey.current = "";
                      }}
                    >
                      {WEPLAY_DIFFICULTY_LABELS[value]}
                    </button>
                  ))}
                </div>
                <div className="weplay-launch-feedback" aria-live="polite">
                  {launchIssue && <p>{launchIssue}</p>}
                </div>
                <button
                  type="button"
                  className="weplay-primary weplay-start"
                  disabled={
                    starting ||
                    loading ||
                    lobby.gameEnabled === false ||
                    availableCount < 3 ||
                    (mode === "challenge" && cannotChallenge)
                  }
                  onClick={() => void start()}
                >
                  <span>
                    {starting
                      ? "시작 준비 중…"
                      : mode === "practice"
                        ? "연습 시작"
                        : `위스 도전 시작 · ${lobby.policy.challengeCost}위스`}
                  </span>
                </button>
              </div>
            </section>
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
      <WeplayGuide
        gameTitle={gameTitle}
        open={guide.open}
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
