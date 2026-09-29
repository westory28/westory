import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  getWeplayLobby,
  startWeplayGame,
  weplayErrorMessage,
  WEPLAY_DIFFICULTY_LABELS,
  DEFAULT_WEPLAY_DIFFICULTIES,
  getWeplayNormalWordCount,
  type WeplayDifficulty,
  type WeplayLobby,
  type WeplayResult,
  type WeplaySession,
} from "../../lib/weplay";
import HistoryRainGame from "./weplay/HistoryRainGame";
import NavalBattleResult from "../../components/common/weplay/NavalBattleResult";
import "./weplay/weplay.css";
import "./weplay/lobby.css";

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const date = (value: number) =>
  new Date(value).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });

export default function Weplay() {
  const { config, currentUser } = useAuth();
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
  const [lesson, setLesson] = useState("");
  const requestKey = useRef("");
  const generation = useRef(0);
  const scope = `${currentUser?.uid || ""}/${config?.year || ""}/${config?.semester || ""}`;
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
        if (restore && next.activeSession) {
          setSession(next.activeSession);
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
    setSession(null);
    setResult(null);
    setLobby(null);
    setLesson("");
    setStarting(false);
    requestKey.current = "";
    if (config && currentUser) void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const start = async () => {
    if (starting || !lobby || lobby.gameEnabled === false) return;
    const startedScope = scope;
    setStarting(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const next = await startWeplayGame(config, {
        mode,
        difficulty,
        requestKey: requestKey.current,
        ...(mode === "practice" && lesson ? { unitIds: [lesson] } : {}),
      });
      if (scopeRef.current !== startedScope) return;
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
  const maxReward = lobby
    ? Math.max(0, ...lobby.policy.resultRewards.map((row) => row.amount))
    : 0;
  const maxLoss = lobby
    ? Math.max(
        0,
        lobby.policy.challengeCost -
          Math.min(...lobby.policy.resultRewards.map((row) => row.amount)),
      )
    : 0;
  const ranking = lobby?.rankingByDifficulty[rankingDifficulty] || [];
  const rankRewards = lobby?.period?.rankingRewards[rankingDifficulty];
  const difficultySettings =
    (mode === "challenge"
      ? lobby?.challengeDifficulties
      : lobby?.difficulties)?.[difficulty] ||
    DEFAULT_WEPLAY_DIFFICULTIES[difficulty];
  const selectedLesson = lobby?.lessons.find((item) => item.unitId === lesson);
  const availableCount =
    mode === "practice" && lesson
      ? (selectedLesson?.wordCountsByDifficulty?.[difficulty] ??
        selectedLesson?.wordCount ??
        0)
      : ((mode === "challenge"
          ? lobby?.challengeWordCountsByDifficulty?.[difficulty]
          : lobby?.wordCountsByDifficulty?.[difficulty]) ??
        lobby?.wordCount ??
        0);
  return (
    <main className="weplay-page">
      <header className="weplay-heading">
        <div>
          <span>위플레이</span>
          <h1>내가 충무공이라고?!</h1>
        </div>
        {lobby && <strong>내 위스 {lobby.balance.toLocaleString()}</strong>}
      </header>
      {session ? (
        <HistoryRainGame
          key={session.id}
          session={session}
          config={config}
          onComplete={complete}
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
              onReplay={() => {
                setResult(null);
                requestKey.current = "";
              }}
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
                  onClick={() => {
                    setResult(null);
                    requestKey.current = "";
                  }}
                  className="weplay-primary"
                >
                  다시 하기
                </button>
              </section>
            )
          )}
          {lobby && !result && (
            <section
              className="weplay-panel weplay-launch"
              aria-label="게임 시작"
            >
              <div className="weplay-launch-art" aria-hidden="true">
                <img
                  className="weplay-launch-allied"
                  src={`${import.meta.env.BASE_URL}assets/weplay/naval/allied-ship.webp`}
                  alt=""
                />
                <img
                  className="weplay-launch-enemy"
                  src={`${import.meta.env.BASE_URL}assets/weplay/naval/enemy-ship.webp`}
                  alt=""
                />
              </div>
              <div className="weplay-launch-controls">
                <div
                  className="weplay-mode"
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
                    연습
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "challenge"}
                    disabled={starting}
                    onClick={() => {
                      setMode("challenge");
                      requestKey.current = "";
                    }}
                  >
                    위스 도전
                  </button>
                </div>
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
                <p className="weplay-rule">
                  {difficultySettings.durationSeconds}초 ·{" "}
                  {difficulty === "mild" ? 2 : difficulty === "medium" ? 3 : 4}
                  단어마다 화포 발사
                </p>
                {mode === "practice" ? (
                  <>
                    <label className="weplay-select">
                      수업 범위
                      <select
                        value={lesson}
                        disabled={starting}
                        onChange={(event) => {
                          setLesson(event.target.value);
                          requestKey.current = "";
                        }}
                      >
                        <option value="">전체 단어</option>
                        {lobby.lessons.map((item) => (
                          <option key={item.unitId} value={item.unitId}>
                            {item.title} (
                            {item.wordCountsByDifficulty?.[difficulty] ??
                              item.wordCount}
                            개)
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>위스 변동 없음</p>
                  </>
                ) : (
                  <>
                    <div className="weplay-stakes">
                      <strong>
                        도전 비용 {lobby.policy.challengeCost}위스
                      </strong>
                      <span>
                        최대 손실 {maxLoss}위스 · 최대 순이익{" "}
                        {Math.max(0, maxReward - lobby.policy.challengeCost)}
                        위스
                      </span>
                      <span>
                        오늘 남은 도전 {lobby.dailyRemaining}회 · 난이도 공통
                      </span>
                    </div>
                    <details>
                      <summary>결과별 지급 위스</summary>
                      <ul className="weplay-rewards">
                        {lobby.policy.resultRewards.map((row, index, rows) => (
                          <li key={row.minCorrect}>
                            <span>
                              성공률 {row.minCorrect * 5}% 이상
                              {rows[index + 1]
                                ? ` ${rows[index + 1].minCorrect * 5}% 미만`
                                : ""}
                            </span>
                            <strong>{row.amount}위스</strong>
                          </li>
                        ))}
                      </ul>
                      <p>
                        일반 단어{" "}
                        {getWeplayNormalWordCount(
                          difficultySettings.durationSeconds,
                        )}
                        개 기준 · 필살기는 전투 점수에 반영
                      </p>
                    </details>
                    {!lobby.policy.enabled && (
                      <p>지금은 연습 게임을 이용할 수 있습니다.</p>
                    )}
                    {lobby.policy.enabled && lobby.dailyRemaining <= 0 && (
                      <p>오늘의 도전을 모두 마쳤습니다.</p>
                    )}
                    {lobby.policy.enabled &&
                      lobby.balance < lobby.policy.challengeCost && (
                        <p>도전에 필요한 위스가 부족합니다.</p>
                      )}
                    <p>
                      도중에 나가도 시간은 계속 흐르고, 처리한 단어만
                      정산됩니다.
                    </p>
                  </>
                )}
                {lobby.gameEnabled === false && (
                  <p role="status">
                    지금은 게임을 쉬고 있습니다. 나중에 다시 이용해 주세요.
                  </p>
                )}
                {availableCount === 0 && lobby.gameEnabled !== false && (
                  <p role="status">
                    선택한 난이도와 범위에 출제할 단어가 없습니다.
                  </p>
                )}
                {availableCount > 0 && availableCount < 3 && (
                  <p role="status">
                    서로 다른 단어가 3개 이상인 난이도와 범위를 선택해 주세요.
                  </p>
                )}
                <button
                  type="button"
                  className="weplay-primary"
                  disabled={
                    starting ||
                    loading ||
                    lobby.gameEnabled === false ||
                    availableCount < 3 ||
                    (mode === "challenge" && cannotChallenge)
                  }
                  onClick={() => void start()}
                >
                  {starting
                    ? "시작 준비 중…"
                    : mode === "practice"
                      ? "연습 시작"
                      : `위스 도전 시작 · ${lobby.policy.challengeCost}위스`}
                </button>
              </div>
            </section>
          )}
          {lobby && (
            <div className="weplay-records-grid">
              <section className="weplay-panel" aria-label="학급 랭킹">
                <h2>우리 반 랭킹</h2>
                <label className="weplay-select">
                  난이도별 랭킹
                  <select
                    value={rankingDifficulty}
                    onChange={(event) =>
                      setRankingDifficulty(
                        event.target.value as WeplayDifficulty,
                      )
                    }
                  >
                    {(
                      Object.keys(
                        WEPLAY_DIFFICULTY_LABELS,
                      ) as WeplayDifficulty[]
                    ).map((value) => (
                      <option key={value} value={value}>
                        {WEPLAY_DIFFICULTY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                {lobby.period && (
                  <>
                    <p>
                      {date(lobby.period.startsAtMs)}~
                      {date(lobby.period.endsAtMs - 1)} · 한 판 최고 기록
                    </p>
                    <p>
                      1위 {rankRewards?.first} · 2위 {rankRewards?.second} · 3위{" "}
                      {rankRewards?.third}위스
                    </p>
                    <small>같은 점수는 먼저 달성한 기록이 앞섭니다.</small>
                  </>
                )}
                {ranking.length ? (
                  <ol className="weplay-ranking">
                    {ranking.map((row) => (
                      <li key={row.rank}>
                        <span>
                          <strong>{row.rank}위</strong> {row.studentLabel}
                          {row.isMe ? " (나)" : ""}
                        </span>
                        <strong>{row.score.toLocaleString()}점</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>아직 도전 기록이 없습니다.</p>
                )}
              </section>
              <section className="weplay-panel" aria-label="개인 기록">
                <h2>내 기록</h2>
                {lobby.records.length ? (
                  <ul className="weplay-history">
                    {lobby.records.map((record) => (
                      <li key={record.sessionId}>
                        <span>
                          {date(record.finishedAtMs)} ·{" "}
                          {record.mode === "practice" ? "연습" : "도전"}
                          {" · "}
                          {WEPLAY_DIFFICULTY_LABELS[record.difficulty]}
                        </span>
                        <span>
                          {record.correctCount}/{record.totalWords}개 ·{" "}
                          {record.score}점
                        </span>
                        <strong>
                          {record.mode === "practice"
                            ? "위스 변동 없음"
                            : `${signed(record.netWis)}위스`}
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>첫 게임을 시작해 보세요.</p>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
