import React, { useEffect, useRef, useState } from "react";
import EntryThinkCloud from "./EntryThinkCloud";
import { Device, MotionTitle, StoryLink } from "./EntryVisuals";
import PublicScoreDemo from "./PublicScoreDemo";
import { useEntrySceneProgress } from "./useEntryMotion";
import { useEntryMotionEnabled } from "./EntryMotionContext";
import { entryMaterial } from "./entryMaterial";
import EntryRibbon from "./EntryRibbon";
import EntryConfirmScene from "./EntryConfirmScene";
import lessonScreen from "../../assets/public-entry/lesson-real.webp";
import worksheet from "../../assets/public-entry/worksheet-real.webp";
import heritage from "../../assets/public-entry/heritage-real.webp";
import mapImage from "../../assets/public-entry/map-real.webp";

export function moveToEntrySection(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({
    behavior:
      section?.closest<HTMLElement>(".public-entry")?.dataset.motion === "off"
        ? "auto"
        : "smooth",
    block: "start",
  });
}

export function EntryOverview() {
  const icons = [
    <React.Fragment key="explore">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5M8 10.5h5m-2.5-2.5v5" />
    </React.Fragment>,
    <React.Fragment key="check">
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </React.Fragment>,
    <React.Fragment key="growth">
      <path d="M4 20V4m0 16h16M8 16l4-5 4 2 4-7m-5 0h5v5" />
    </React.Fragment>,
    <React.Fragment key="play">
      <path d="M8 6h8c2 0 3 1 3.5 3l1.5 7c.5 2.5-2 4-3.5 2L15 15H9l-2.5 3C5 20 2.5 18.5 3 16l1.5-7C5 7 6 6 8 6ZM7 9v4m-2-2h4m7-1h.01M18 12h.01" />
    </React.Fragment>,
  ];
  return (
    <nav
      className="entry-overview"
      aria-label="위스토리 전체 기능"
      data-entry-reveal
    >
      {[
        ["01", "탐구", "자료 · 지도 · 생각모아", "entry-lesson"],
        ["02", "확인", "문제풀이 · 성적 확인", "entry-check"],
        ["03", "성장", "평가 · 목표 · 마이페이지", "entry-growth"],
        ["04", "몰입", "위플레이", "entry-game"],
      ].map(([n, title, sub, id], index) => (
        <button
          type="button"
          key={id}
          onClick={() => moveToEntrySection(id)}
          style={{ "--order": index } as React.CSSProperties}
        >
          <span className="entry-overview-symbol" aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              {icons[index]}
            </svg>
            <span>{n}</span>
          </span>
          <strong>
            {title}
            <span aria-hidden="true">↗</span>
          </strong>
          <small>{sub}</small>
        </button>
      ))}
    </nav>
  );
}

const lessonSlides = [
  {
    label: "한눈에 연결",
    title: ["복잡한 개념도,", "흐름이 보이게."],
    description:
      "왕권과 신권의 변화를 하나의 학습지에서 비교합니다. 따로 외우던 사실들이 원인과 결과로 연결됩니다.",
    image: worksheet,
    alt: "실제 제작 학습지: 500년 국가의 기틀 확립, 태종부터 성종까지의 통치 방식과 정치 기구 비교",
  },
  {
    label: "직접 채우기",
    title: ["빈칸을 채우며,", "내 이해를 확인."],
    description:
      "읽은 내용을 떠올리고 직접 답을 채웁니다. 헷갈리는 개념은 자료로 돌아가 다시 확인합니다.",
    image: lessonScreen,
    alt: "실제 위스토리 학습지 렌더러: 500년 국가의 기틀 확립의 빈칸 학습 화면",
  },
  {
    label: "자료로 탐구",
    title: ["유물을 보고,", "시대를 읽다."],
    description:
      "천문 기구부터 기록과 건축까지. 문화유산 속에 담긴 당대의 생활과 생각을 찾아갑니다.",
    image: heritage,
    alt: "실제 제작 학습지: 조선 전기의 문화 유산, 혼천의와 자격루, 기록과 건축 자료",
  },
];

export function LessonScene() {
  const root = useRef<HTMLElement>(null);
  const motionEnabled = useEntryMotionEnabled();
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (!motionEnabled) return;
    let frame = 0,
      last = -1;
    const read = () => {
      frame = 0;
      const el = root.current;
      if (!el || innerHeight < 800) return;
      const rect = el.getBoundingClientRect();
      const stage = el.firstElementChild as HTMLElement;
      if (getComputedStyle(stage).position !== "sticky") return;
      const progress = Math.max(
        0,
        Math.min(
          1,
          (80 - rect.top) /
            Math.max(1, (rect.height - stage.offsetHeight) * 0.6),
        ),
      );
      const next = Math.min(2, Math.floor(progress * 3));
      if (rect.top < innerHeight && rect.bottom > 0 && last !== next) {
        last = next;
        setSlide(next);
      }
    };
    const request = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request, { passive: true });
    request();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, [motionEnabled]);
  return (
    <section
      ref={root}
      id="entry-lesson"
      tabIndex={-1}
      className="entry-scene entry-lesson-deck"
      data-entry-scene
      aria-label="실제 수업 자료 둘러보기"
    >
      <div className="entry-stage entry-deck-stage">
        <EntryRibbon variant="wide" />
        <div className="entry-deck-heading">
          <StoryLink number="01" label="수업 자료" />
          <MotionTitle
            effect="depth"
            lines={["한 장의 자료에서,", "깊어지는 생각."]}
          />
        </div>
        <div
          className="entry-deck-content"
          role="region"
          aria-roledescription="슬라이드쇼"
          aria-label="실제 학습지 3장"
        >
          <div className="entry-slide-copy" aria-live="polite">
            <span className="entry-slide-count">0{slide + 1} / 03</span>
            <h3>
              {lessonSlides[slide].title[0]} <br />
              <span>{lessonSlides[slide].title[1]}</span>
            </h3>
            <p>{lessonSlides[slide].description}</p>
          </div>
          <div className="entry-slide-device">
            <Device kind="laptop">
              {lessonSlides.map((item, index) => (
                <div
                  className="entry-material-slide"
                  key={item.label}
                  data-active={slide === index}
                  role="group"
                  aria-roledescription="슬라이드"
                  aria-label={`${index + 1} / 3 ${item.label}`}
                  aria-hidden={slide !== index}
                >
                  <img
                    src={item.image}
                    alt={item.alt}
                    width="1500"
                    height="1060"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ))}
            </Device>
          </div>
        </div>
        <div className="entry-slide-controls" aria-label="학습지 슬라이드 선택">
          <button
            type="button"
            aria-label="이전 학습지"
            onClick={() => setSlide((slide + 2) % 3)}
          >
            ←
          </button>
          <div>
            {lessonSlides.map((item, index) => (
              <button
                type="button"
                key={item.label}
                aria-pressed={slide === index}
                onClick={() => setSlide(index)}
              >
                <span aria-hidden="true">0{index + 1}</span>
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="다음 학습지"
            onClick={() => setSlide((slide + 1) % 3)}
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}

function FeatureScene({
  id,
  number,
  label,
  lines,
  description,
  children,
  className = "",
  sceneRef,
  timeline = false,
}: {
  id: string;
  number: string;
  label: string;
  lines: string[];
  description: string;
  children: React.ReactNode;
  className?: string;
  sceneRef?: React.RefObject<HTMLElement>;
  timeline?: boolean;
}) {
  return (
    <section
      ref={sceneRef}
      id={id}
      tabIndex={-1}
      className={`entry-feature entry-scene ${className}`}
      data-entry-scene
      data-entry-timeline={timeline ? "" : undefined}
      aria-labelledby={`${id}-title`}
    >
      <div className="entry-stage entry-split-stage">
        <EntryRibbon
          variant={id === "entry-map" || id === "entry-check" ? "left" : "wide"}
        />
        <div className="entry-heading">
          <StoryLink number={number} label={label} />
          <MotionTitle
            id={`${id}-title`}
            lines={lines}
            effect={id === "entry-map" ? "add" : "gather"}
          />
          <p className="entry-benefit">{description}</p>
        </div>
        <div className="entry-feature-visual">{children}</div>
      </div>
    </section>
  );
}

const mapPlaces = [
  { name: "개성", era: "고려의 수도", x: 37.6, y: 51.5 },
  { name: "한성", era: "조선의 수도", x: 43.3, y: 55.6 },
  { name: "경주", era: "신라의 수도", x: 68.0, y: 71.8 },
];
export function MapScene() {
  const [selected, setSelected] = useState<number | null>(null);
  const place = selected === null ? null : mapPlaces[selected];
  return (
    <FeatureScene
      id="entry-map"
      number="02"
      label="지도 · 지명 확인"
      lines={["사건의 자리에,", "맥락을 더하다."]}
      description="같은 땅도 시대에 따라 다른 이야기를 품습니다. 직접 만든 역사 지도에서 지명을 확인하고, 장소와 사건의 관계를 살펴봅니다."
      className="entry-map-section"
    >
      <div className="entry-map-composition">
        <Device kind="tablet">
          <div className="entry-map-toolbar">
            <strong>한반도 역사 지리</strong>
            <span>PDF 지명 확인</span>
          </div>
          <div className="entry-map-window">
            <div
              className="entry-map-sheet"
              style={{
                transform: place ? `scale(2.1)` : "scale(1)",
                transformOrigin: place ? `${place.x}% ${place.y}%` : "50% 50%",
              }}
            >
              <img
                src={mapImage}
                width="1037"
                height="1383"
                loading="lazy"
                alt="실제 제작 한반도 역사 지리 지도"
              />
              {place && (
                <span
                  className="entry-map-pin"
                  style={{ left: place.x + "%", top: place.y + "%" }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </Device>
        <div className="entry-map-label" aria-live="polite">
          <span>{place ? place.era : "지명에서 시대까지"}</span>
          <strong>{place?.name || "한반도 역사 지리"}</strong>
        </div>
      </div>
      <div className="entry-place-controls" aria-label="지도 지명 탐색">
        {mapPlaces.map((p, i) => (
          <button
            type="button"
            aria-pressed={selected === i}
            key={p.name}
            onClick={() => setSelected(i)}
          >
            {p.name}
            <span>↗</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelected(null)}
          aria-pressed={selected === null}
        >
          전체 지도
        </button>
      </div>
    </FeatureScene>
  );
}

export function ThinkScene() {
  return (
    <FeatureScene
      id="entry-think"
      number="03"
      label="생각모아"
      lines={["나의 한 단어가,", "우리의 관점으로."]}
      description="같은 질문에 모인 서로 다른 생각. 자주 나온 단어와 낯선 관점을 비교하며 내 해석을 넓혀 갑니다."
    >
      <EntryThinkCloud />
    </FeatureScene>
  );
}

export function CheckScene() {
  const [answer, setAnswer] = useState<number | null>(null);
  const q = entryMaterial.quiz;
  return (
    <>
      <FeatureScene
        id="entry-check"
        number="04"
        label="문제풀이"
        lines={["정답을 넘어,", "이유를 아는 힘."]}
        description="배운 내용을 문제에 적용하고, 해설에서 판단의 근거를 확인합니다. 맞고 틀림을 다음 탐구의 출발점으로 바꿉니다."
      >
        <div className="entry-question-panel">
          <div className="entry-panel-label">
            <span>위스토리 실제 등록 문항</span>
            <span>객관식</span>
          </div>
          <h3>{q.question}</h3>
          <div className="entry-question-options">
            {q.options.map((option, i) => (
              <button
                type="button"
                key={option}
                aria-pressed={answer === i}
                aria-describedby="entry-question-feedback"
                data-result={
                  answer === i
                    ? option === q.answer
                      ? "correct"
                      : "incorrect"
                    : undefined
                }
                onClick={() => setAnswer(i)}
              >
                <span>{i + 1}</span>
                {option}
                {answer === i && (
                  <small className="entry-answer-result">
                    {option === q.answer ? "정답" : "오답"}
                  </small>
                )}
              </button>
            ))}
          </div>
          <p
            id="entry-question-feedback"
            className="entry-question-feedback"
            data-result={
              answer === null
                ? undefined
                : q.options[answer] === q.answer
                  ? "correct"
                  : "incorrect"
            }
            aria-live="polite"
          >
            {answer === null
              ? "어떤 설명이 가장 적절할까요?"
              : (q.options[answer] === q.answer
                  ? "정답입니다. "
                  : "오답입니다. ") + q.explanation}
          </p>
        </div>
      </FeatureScene>
      <EntryConfirmScene />
    </>
  );
}

export function GrowthScene() {
  return (
    <FeatureScene
      id="entry-growth"
      number="05"
      label="평가 관리 · 나의 성적"
      lines={["얼마나 달라질까?", "목표가 보이는 성적."]}
      description="정기시험과 수행평가 점수를 움직여 보세요. 반영 점수와 성취도가 함께 변하면, 다음 목표에 필요한 노력이 구체적으로 보입니다."
    >
      <PublicScoreDemo />
    </FeatureScene>
  );
}

export function RecordScene() {
  const scene = useRef<HTMLElement>(null);
  const scrollProgress = useEntrySceneProgress(scene);
  const [manualProgress, setManualProgress] = useState<number | null>(null);
  useEffect(() => setManualProgress(null), [scrollProgress]);
  const progress =
    manualProgress ?? Math.max(0, Math.min(1, (scrollProgress - 0.08) / 0.78));
  const values = [62, 74, 84, 94];
  const points = values.map((v, i) => [52 + i * 114, 228 - v * 1.7]);
  const travel = progress * (values.length - 1);
  const selected = Math.floor(travel);
  const segment = Math.min(selected, values.length - 2);
  const fraction = travel - segment;
  const current = Math.round(
    values[segment] + (values[segment + 1] - values[segment]) * fraction,
  );
  const cursor = points[segment].map(
    (v, axis) => v + (points[segment + 1][axis] - v) * fraction,
  );
  const revealed = [...points.slice(0, segment + 1), cursor];
  return (
    <FeatureScene
      sceneRef={scene}
      timeline
      className="entry-record-scene"
      id="entry-record"
      number="05"
      label="평가 돌아보기"
      lines={["한 번의 점수보다,", "쌓여가는 변화."]}
      description="점수의 변화에서 잘한 점과 보완할 점을 찾아갑니다. 결과를 다음 학습의 출발점으로."
    >
      <div className="entry-record-chart">
        <div className="entry-panel-label">
          <span>성장 흐름 예시</span>
          <span>가상 학습 기록</span>
        </div>
        <div className="entry-record-value">
          <strong>
            {current}
            <small>점</small>
          </strong>
          <span>
            {
              ["첫 기록", "이해를 넓히고", "근거를 더하고", "한 걸음 더"][
                selected
              ]
            }
          </span>
        </div>
        <svg
          viewBox="0 0 440 270"
          role="img"
          aria-label={`가상 성장 그래프: 첫 기록 62점에서 현재 ${current}점`}
        >
          <defs>
            <linearGradient id="entry-growth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity=".2" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[60, 100, 140, 180, 220].map((y) => (
            <line
              key={y}
              x1="32"
              x2="418"
              y1={y}
              y2={y}
              className="entry-chart-grid"
            />
          ))}
          <path
            d={`M52 240 L${revealed
              .map((p) => p.join(" "))
              .join(" L")} L${cursor[0]} 240 Z`}
            fill="url(#entry-growth-fill)"
          />
          <polyline
            points={points.map((p) => p.join(",")).join(" ")}
            className="entry-chart-future"
          />
          <polyline
            points={revealed.map((p) => p.join(",")).join(" ")}
            className="entry-chart-line"
          />
          {points.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={5}
              className={
                i <= selected ? "entry-chart-point" : "entry-chart-future-point"
              }
            />
          ))}
          <circle
            cx={cursor[0]}
            cy={cursor[1]}
            r="14"
            className="entry-chart-cursor-halo"
          />
          <circle
            cx={cursor[0]}
            cy={cursor[1]}
            r="7"
            className="entry-chart-point"
          />
          <line x1="32" x2="418" y1="75" y2="75" className="entry-chart-goal" />
          <text x="412" y="65" textAnchor="end">
            목표 90
          </text>
        </svg>
        <div className="entry-record-dates">
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={selected === i}
              onClick={() => setManualProgress(i / (values.length - 1))}
            >
              {i + 1}번째 기록<span>{v}점</span>
            </button>
          ))}
        </div>
        <div className="entry-record-tags">
          <span>성취 현황</span>
          <span>다음 목표</span>
          <span>최근 평가</span>
        </div>
      </div>
    </FeatureScene>
  );
}
