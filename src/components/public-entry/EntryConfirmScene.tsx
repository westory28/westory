import { useEffect, useRef, useState } from "react";
import { Device, MotionTitle, StoryLink } from "./EntryVisuals";
import EntryRibbon from "./EntryRibbon";
import { useEntrySceneProgress } from "./useEntryMotion";
import score from "../../assets/public-entry/confirmation-score.webp";
import question from "../../assets/public-entry/confirmation-question.webp";
import signature from "../../assets/public-entry/confirmation-signature.webp";
import "./entry-confirm-scene.css";

const screens = [
  {
    title: "점수·채점 확인",
    image: score,
    description: "점수와 평가 근거를 함께 살펴봅니다.",
    alt: "실제 수행평가 점수 화면: 가상 점수 52/60과 자료 해석·근거 제시·역사적 설명 그래프",
  },
  {
    title: "문의·이의 제기",
    image: question,
    description: "궁금한 채점 내용은 근거를 들어 묻습니다.",
    alt: "실제 이의 신청 화면: 가상 역사 자료 탐구 평가의 채점 기준을 문의하는 예시",
  },
  {
    title: "확인 후 서명",
    image: signature,
    description: "확인한 내용을 서명으로 마무리합니다.",
    alt: "실제 수행평가 확인 및 서명 화면: 가상 점수와 비어 있는 서명 칸",
  },
];

export default function EntryConfirmScene() {
  const root = useRef<HTMLElement>(null);
  const progress = useEntrySceneProgress(root);
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (
      innerHeight < 700 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    setSlide(Math.min(2, Math.floor(progress * 3)));
  }, [progress]);
  return (
    <section
      ref={root}
      id="entry-confirm"
      className="entry-confirm-scene entry-scene"
      data-entry-scene
      data-entry-timeline
      aria-labelledby="entry-confirm-title"
    >
      <div className="entry-stage entry-confirm-stage">
        <EntryRibbon variant="wide" />
        <div className="entry-confirm-copy">
          <StoryLink number="CHECK" label="성적 확인" />
          <MotionTitle
            id="entry-confirm-title"
            lines={["확인하고, 묻고,", "마무리."]}
          />
          <p className="entry-benefit" aria-live="polite">
            {screens[slide].description}
          </p>
        </div>
        <div className="entry-confirm-preview">
          <Device kind="tablet">
            <div
              className="entry-confirm-screens"
              role="region"
              aria-roledescription="슬라이드쇼"
              aria-label="실제 성적 확인 화면 3단계"
            >
              {screens.map((screen, index) => (
                <div
                  key={screen.title}
                  className="entry-confirm-screen"
                  data-active={slide === index}
                  aria-hidden={slide !== index}
                >
                  <img
                    src={screen.image}
                    alt={screen.alt}
                    width="1280"
                    height="960"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ))}
            </div>
          </Device>
          <div
            className="entry-confirm-controls"
            aria-label="성적 확인 단계 선택"
          >
            {screens.map((screen, index) => (
              <button
                key={screen.title}
                type="button"
                aria-pressed={slide === index}
                onClick={() => setSlide(index)}
              >
                <span>0{index + 1}</span>
                {screen.title}
              </button>
            ))}
          </div>
          <p className="entry-confirm-example">
            실제 성적 확인 화면 · 가상 점수 예시
          </p>
        </div>
      </div>
    </section>
  );
}
