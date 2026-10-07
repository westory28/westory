import { useEffect, useId, useRef, type CSSProperties } from "react";
import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayResult,
} from "../../../lib/weplay";
import "./naval-result.css";
import { DEFAULT_WEPLAY_GAME_TITLE } from "../../../lib/weplayTitle";

interface Props {
  gameTitle?: string;
  result: WeplayResult;
  preview?: boolean;
  replaying?: boolean;
  onReplay: () => void;
  onLobby?: () => void;
}

export default function NavalBattleResult({
  gameTitle = DEFAULT_WEPLAY_GAME_TITLE,
  result,
  preview = false,
  replaying = false,
  onReplay,
  onLobby,
}: Props) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const battle = result.battle;
  const endedEarly = Boolean(result.endedEarly);
  const defeated = !endedEarly && battle?.outcome === "defeat";
  const art = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;
  const signedWis = `${result.netWis > 0 ? "+" : ""}${result.netWis}`;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [result.sessionId]);

  return (
    <section
      className={`naval-result${defeated ? " naval-result--defeat" : ""}`}
      aria-labelledby={titleId}
      style={
        {
          "--naval-result-sea": `url("${art}sea-battle.webp")`,
        } as CSSProperties
      }
    >
      <header className="naval-result-heading">
        <span>{gameTitle}</span>
        <div className="naval-result-tags">
          <strong>{WEPLAY_DIFFICULTY_LABELS[result.difficulty]}</strong>
          <span>
            {preview
              ? "교사 체험"
              : result.mode === "practice"
                ? "연습"
                : "위스 도전"}
          </span>
        </div>
      </header>
      <div className="naval-result-banner">
        <img src={`${art}allied-ship.webp`} alt="" aria-hidden="true" />
        <div>
          <p className="naval-result-kicker">
            {endedEarly ? "중도 종료" : "전투 결과"}
          </p>
          <h2 ref={heading} tabIndex={-1} id={titleId}>
            {endedEarly
              ? "전투 종료"
              : defeated
                ? "함선 침몰"
                : "해역 방어 완료"}
          </h2>
          <p className="naval-result-score">
            <strong>{result.score.toLocaleString()}</strong>
            <span>점</span>
          </p>
        </div>
      </div>
      <div className="naval-result-record">
        <dl className="naval-result-stats">
          <div>
            <dt>격침한 적선</dt>
            <dd>
              {battle?.sunkShips ?? 0}
              <small>척</small>
            </dd>
          </div>
          <div>
            <dt>함포 발사</dt>
            <dd>
              {battle?.cannonShots ?? 0}
              <small>회</small>
            </dd>
          </div>
          <div>
            <dt>필살기 성공</dt>
            <dd>
              {battle?.specialCount ?? 0}
              <small>회</small>
            </dd>
          </div>
          <div>
            <dt>맞힌 수업 단어</dt>
            <dd>
              {result.correctCount}
              <small>/ {result.totalWords}개</small>
            </dd>
          </div>
        </dl>
        <div className="naval-result-settlement">
          {preview ? (
            <p>교사 체험 · 위스·랭킹·학생 기록에 반영되지 않습니다.</p>
          ) : result.mode === "practice" ? (
            <p>연습 · 위스 변동 없음</p>
          ) : (
            <>
              <p>
                <span>이번 전투 위스</span>
                <strong>{signedWis}위스</strong>
              </p>
              <p>
                도전 비용 {result.cost}위스 · 결과 지급 {result.reward}위스
              </p>
            </>
          )}
        </div>
        {result.missedWords.length > 0 && (
          <details className="naval-result-missed">
            <summary>놓친 단어 {result.missedWords.length}개</summary>
            <ul>
              {result.missedWords.map((word) => (
                <li key={word.id}>
                  <strong>{word.text}</strong>
                  {(word.context || word.lessonTitle) && (
                    <span>{word.context || word.lessonTitle}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="naval-result-actions">
          {onLobby && (
            <button
              type="button"
              className="naval-result-lobby"
              disabled={replaying}
              onClick={onLobby}
            >
              게임 메인으로
            </button>
          )}
          <button type="button" disabled={replaying} onClick={onReplay}>
            {replaying ? "준비 중…" : preview ? "다시 체험" : "다시 하기"}
          </button>
        </div>
      </div>
    </section>
  );
}
