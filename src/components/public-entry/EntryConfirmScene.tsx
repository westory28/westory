import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Device, MotionTitle, StoryLink } from "./EntryVisuals";
import EntryGlow from "./EntryGlow";
import { useEntryScrollSlides } from "./useEntryScrollSlides";
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
    alt: "실제 수행평가 확인 및 서명 화면: 가상 점수와 위스토리 손글씨 서명 예시",
  },
];

// Invented handwriting of the brand, never a student's name or signature.
const signatureStrokes = [
  {
    d: "M103 43 C132 38 142 68 116 80 C91 91 76 69 88 51 C92 45 98 43 103 43",
    delay: 0,
    duration: 180,
  },
  { d: "M72 106 Q104 101 140 98", delay: 180, duration: 90 },
  { d: "M108 103 Q106 126 104 151", delay: 270, duration: 90 },
  { d: "M157 43 Q154 94 157 151", delay: 360, duration: 100 },
  { d: "M224 46 Q216 78 192 96", delay: 460, duration: 90 },
  { d: "M220 61 Q235 83 249 91", delay: 550, duration: 90 },
  { d: "M184 132 Q220 127 264 126", delay: 640, duration: 100 },
  { d: "M304 47 Q331 42 366 42", delay: 740, duration: 60 },
  { d: "M305 47 L301 96 Q334 91 369 91", delay: 800, duration: 100 },
  { d: "M305 71 Q332 68 357 67", delay: 900, duration: 80 },
  { d: "M339 109 Q339 125 338 143", delay: 980, duration: 120 },
  { d: "M298 148 Q336 142 384 142", delay: 1100, duration: 100 },
  {
    d: "M427 49 Q452 45 479 44 L476 79 L427 83 L425 116 Q450 114 485 110",
    delay: 1200,
    duration: 220,
  },
  { d: "M512 40 Q507 92 510 150", delay: 1420, duration: 180 },
];

function SignatureWriting({ imageReady }: { imageReady: boolean }) {
  const surface = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.35, rootMargin: "-80px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <svg
      ref={surface}
      className="entry-confirm-signature"
      viewBox="0 0 660 210"
      data-writing={visible && imageReady}
      aria-hidden="true"
    >
      <g transform="translate(35 20)">
        {signatureStrokes.map((stroke, index) => (
          <path
            key={index}
            d={stroke.d}
            pathLength="1"
            style={
              {
                "--stroke-delay": `${stroke.delay}ms`,
                "--stroke-duration": `${stroke.duration}ms`,
              } as CSSProperties
            }
          />
        ))}
      </g>
    </svg>
  );
}

export default function EntryConfirmScene() {
  const root = useRef<HTMLElement>(null);
  const [slide, setSlide] = useEntryScrollSlides(root, 700);
  const [signatureImageReady, setSignatureImageReady] = useState(false);
  const [signatureReplay, setSignatureReplay] = useState(0);
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
        <EntryGlow variant="wide" />
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
        <div className="entry-confirm-preview-track" data-entry-slide-track>
          <div className="entry-confirm-preview" data-entry-slide-stage>
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
                      onLoad={
                        index === 2
                          ? () => setSignatureImageReady(true)
                          : undefined
                      }
                    />
                    {index === 2 && slide === 2 && (
                      <SignatureWriting
                        key={signatureReplay}
                        imageReady={signatureImageReady}
                      />
                    )}
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
                  onClick={() => {
                    setSlide(index);
                    if (index === 2)
                      setSignatureReplay((current) => current + 1);
                  }}
                >
                  <span>0{index + 1}</span>
                  {screen.title}
                </button>
              ))}
            </div>
            <p className="entry-confirm-example">
              실제 성적 확인 화면 · 가상 점수·서명 예시
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
