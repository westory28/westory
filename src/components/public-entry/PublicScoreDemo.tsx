import React, { useEffect, useId, useRef, useState } from "react";
import { getGradeBand, type ScoreBand } from "../../lib/studentScores";
import "./public-score-demo.css";

const nextBands: Partial<
  Record<ScoreBand, { band: ScoreBand; score: number }>
> = {
  E: { band: "D", score: 59.5 },
  D: { band: "C", score: 69.5 },
  C: { band: "B", score: 79.5 },
  B: { band: "A", score: 89.5 },
};
const formatScore = (value: number) => Number(value.toFixed(1)).toString();

function AchievementHelp() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="entry-score-lab__help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="entry-score-lab__help-button"
        aria-label="성취도 기준 안내"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} role="tooltip" className="entry-score-lab__tooltip">
          <strong>일반 교과 성취도</strong>
          <span>A 90 이상 · B 80 이상 · C 70 이상 · D 60 이상 · E 60 미만</span>
          <span>
            환산 점수를 정수로 반올림해 판정합니다. 예를 들어 89.5점은 90점으로
            반올림되어 A입니다.
          </span>
          <span>이 체험은 역사 교과의 5단계 기준을 사용합니다.</span>
        </span>
      )}
    </span>
  );
}

/** Local calculator only; no student records, persistence or service calls. */
export default function PublicScoreDemo() {
  const [exam, setExam] = useState(80);
  const [performance, setPerformance] = useState(90);
  const id = useId();
  const examWeighted = Number((exam * 0.6).toFixed(1));
  const performanceWeighted = Number((performance * 0.4).toFixed(1));
  const total = Number((examWeighted + performanceWeighted).toFixed(1));
  const band = getGradeBand(total, "역사");
  const next = nextBands[band];
  const remaining = next ? Number((next.score - total).toFixed(1)) : 0;

  return (
    <section className="entry-score-lab" aria-labelledby={id + "-title"}>
      <div className="entry-score-lab__heading">
        <div>
          <span className="entry-score-lab__eyebrow">직접 바꿔 보는 성적</span>
          <div className="entry-score-lab__title-row">
            <h3 id={id + "-title"}>나의 성적 계산기</h3>
            <AchievementHelp />
          </div>
        </div>
        <span className="entry-score-lab__subject">역사</span>
      </div>

      <div
        className="entry-score-lab__result"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="entry-score-lab__total">
          <span>환산 점수</span>
          <output htmlFor={id + "-exam " + id + "-performance"}>
            {formatScore(total)}
            <small> / 100</small>
          </output>
        </div>
        <div className="entry-score-lab__grade">
          <span>성취도</span>
          <strong>{band}</strong>
        </div>
      </div>

      <div className="entry-score-lab__graph">
        <div
          className="entry-score-lab__track"
          role="img"
          aria-label={`정기시험 환산 ${formatScore(examWeighted)}점, 수행평가 환산 ${formatScore(performanceWeighted)}점, 합계 ${formatScore(total)}점`}
        >
          <span
            className="entry-score-lab__exam-bar"
            style={{ width: examWeighted + "%" }}
          />
          <span
            className="entry-score-lab__performance-bar"
            style={{ width: performanceWeighted + "%" }}
          />
          {next && (
            <span
              className="entry-score-lab__threshold"
              style={{ left: next.score + "%" }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="entry-score-lab__axis" aria-hidden="true">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
        <div className="entry-score-lab__legend">
          <span>
            <i className="entry-score-lab__exam-dot" />
            정기시험 60%
          </span>
          <span>
            <i className="entry-score-lab__performance-dot" />
            수행평가 40%
          </span>
        </div>
      </div>

      <p
        className="entry-score-lab__next"
        aria-live="polite"
        aria-atomic="true"
      >
        {next ? (
          <>
            <span
              className="entry-score-lab__threshold-key"
              aria-hidden="true"
            />
            <strong>{next.band}까지</strong> 환산 {formatScore(remaining)}점 더
          </>
        ) : (
          <>
            <strong>A 달성</strong> 가장 높은 성취도에 도달했어요.
          </>
        )}
      </p>

      <div className="entry-score-lab__sliders">
        <div className="entry-score-lab__slider">
          <label htmlFor={id + "-exam"}>
            <span>
              정기시험 <small>60% 반영</small>
            </span>
            <strong>{exam}점</strong>
          </label>
          <input
            id={id + "-exam"}
            type="range"
            min="0"
            max="100"
            step="1"
            value={exam}
            aria-valuetext={`${exam}점, 100점 만점`}
            onChange={(event) => setExam(Number(event.target.value))}
          />
        </div>
        <div className="entry-score-lab__slider">
          <label htmlFor={id + "-performance"}>
            <span>
              수행평가 <small>40% 반영</small>
            </span>
            <strong>{performance}점</strong>
          </label>
          <input
            id={id + "-performance"}
            type="range"
            min="0"
            max="100"
            step="1"
            value={performance}
            aria-valuetext={`${performance}점, 100점 만점`}
            onChange={(event) => setPerformance(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="entry-score-lab__footer">
        <p>정기 60% · 수행 40%의 가상 예시이며, 공식 성적이 아닙니다.</p>
        <button
          type="button"
          onClick={() => {
            setExam(80);
            setPerformance(90);
          }}
        >
          초기화
        </button>
      </div>
    </section>
  );
}
