import React, { useState } from "react";
import WordCloudView from "../common/WordCloudView";

export function moveToEntrySection(id: string) {
  const section = document.getElementById(id);
  if (!section) return;
  section.focus({ preventScroll: true });
  section.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}

export function EntryOverview() {
  const groups = [
    {
      title: "탐구하기",
      items: [
        ["수업 자료", "entry-lesson"],
        ["지도 · 지명 확인", "entry-map"],
        ["생각모아", "entry-think"],
      ],
    },
    {
      title: "확인하기",
      items: [
        ["문제풀이", "entry-check"],
        ["성적 확인", "entry-check"],
        ["평가 · 성적 그래프", "entry-growth"],
      ],
    },
    { title: "반복하기", items: [["위플레이", "entry-game"]] },
    { title: "돌아보기", items: [["마이페이지", "entry-record"]] },
  ];
  return (
    <nav className="entry-overview" aria-label="위스토리 전체 기능">
      {groups.map((group, index) => (
        <div key={group.title}>
          <span className="entry-overview-number">0{index + 1}</span>
          <h3>{group.title}</h3>
          {group.items.map(([label, id]) => (
            <button
              type="button"
              key={label}
              onClick={() => moveToEntrySection(id)}
            >
              {label}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

function FeatureScene({
  id,
  number,
  label,
  title,
  accent,
  description,
  children,
}: {
  id: string;
  number: string;
  label: string;
  title: string;
  accent: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className="entry-feature entry-scene"
      data-entry-scene
      aria-labelledby={id + "-title"}
    >
      <div className="entry-stage entry-split-stage">
        <div className="entry-heading">
          <p className="entry-eyebrow">
            <span>{number}</span>
            {label}
          </p>
          <h2 id={id + "-title"}>
            <span className="entry-line">{title}</span>
            <span className="entry-line entry-accent">{accent}</span>
          </h2>
          <p className="entry-benefit">{description}</p>
        </div>
        <div className="entry-feature-visual">{children}</div>
        <div className="entry-scene-track" aria-hidden="true">
          <span />
        </div>
      </div>
    </section>
  );
}

export function MapScene() {
  const [revealed, setRevealed] = useState(false);
  return (
    <FeatureScene
      id="entry-map"
      number="02"
      label="지도 · 지명 확인"
      title="어디에서,"
      accent="왜 일어났을까."
      description="지도에서 지명과 사건을 연결하고, 시대·지역 태그로 맥락을 살펴봅니다. PDF에서 추출한 지명을 찾아 해당 지역으로 이동하며 사건의 공간적 배경을 살펴봅니다."
    >
      <div className="entry-demo entry-map-demo">
        <div className="entry-demo-top">
          <strong>장소로 읽는 역사</strong>
          <span>탐색 예시</span>
        </div>
        <svg
          viewBox="0 0 520 350"
          role="img"
          aria-label={
            revealed
              ? "축약 도식: 한양과 남해의 한산도 위치 관계"
              : "축약 도식: 한양과 남해의 탐색 지점"
          }
        >
          <path
            className="entry-map-land"
            d="M335 10 L374 28 363 68 326 99 338 130 322 156 330 190 296 225 308 256 279 287 238 310 202 301 184 276 155 269 169 240 149 218 183 194 202 164 198 139 235 112 232 84 268 65 299 42Z"
          />
          <path
            className="entry-map-route"
            d="M226 148 C310 186 176 217 234 297"
          />
          <circle cx="226" cy="148" r="7" />
          <text x="243" y="148">
            한양
          </text>
          <circle cx="234" cy="297" r="7" />
          <text x="252" y="304">
            {revealed ? "한산도" : "탐색 지점"}
          </text>
          <text className="entry-map-sea-label" x="380" y="215">
            동해
          </text>
        </svg>
        <div className="entry-demo-actions">
          <span>PDF 지명 추출 → 지역 확인</span>
          <button
            type="button"
            aria-pressed={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? "선택 해제" : "지명 확인"}
          </button>
        </div>
        <p className="entry-demo-note">
          기능 설명용 축약 도식 · 실제 축척과 다릅니다.
        </p>
      </div>
    </FeatureScene>
  );
}

const words = [
  { text: "백성", count: 12 },
  { text: "소통", count: 10 },
  { text: "배움", count: 8 },
  { text: "문자", count: 7 },
  { text: "기회", count: 5 },
  { text: "기록", count: 5 },
  { text: "공감", count: 4 },
  { text: "지식", count: 3 },
  { text: "변화", count: 3 },
];
export function ThinkScene() {
  return (
    <FeatureScene
      id="entry-think"
      number="03"
      label="생각모아"
      title="같은 질문,"
      accent="서로 다른 생각."
      description="질문에 답한 단어들이 워드클라우드로 모입니다. 자주 나온 생각과 새로운 관점을 비교하며, 내 해석을 넓혀 갈 실마리를 찾습니다."
    >
      <div className="entry-demo entry-cloud-demo">
        <div className="entry-demo-top">
          <strong>훈민정음은 무엇을 바꾸었을까?</strong>
          <span>가상 응답</span>
        </div>
        <div
          className="entry-cloud-frame"
          role="img"
          aria-label="가상 응답 워드클라우드: 백성 12, 소통 10, 배움 8, 문자 7, 기회와 기록 5, 공감 4, 지식과 변화 3"
        >
          <div aria-hidden="true">
            <WordCloudView
              entries={words}
              showSubmitters={false}
              className="entry-cloud-renderer"
            />
          </div>
        </div>
        <div className="entry-demo-actions">
          <span>나의 생각에서, 우리 반의 관점으로</span>
        </div>
      </div>
    </FeatureScene>
  );
}

export function CheckScene() {
  const [answer, setAnswer] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const steps = ["점수·채점 내용 확인", "이상이 있으면 문의", "확인 후 서명"];
  return (
    <FeatureScene
      id="entry-check"
      number="04"
      label="문제풀이 · 성적 확인"
      title="맞혔는지보다,"
      accent="왜 그런지까지."
      description="자료에서 읽은 근거로 문제를 풀고 이해를 점검합니다. 공개된 평가의 점수와 채점 내용을 살펴보고, 궁금한 점은 문의한 뒤 확인·서명으로 마무리합니다."
    >
      <div className="entry-demo entry-check-demo">
        <div className="entry-demo-top">
          <strong>근거로 답하기</strong>
          <span>학습 예시</span>
        </div>
        <p className="entry-quote">
          “백성이 자신의 생각을 쉽게 표현할 수 있도록”
        </p>
        <h3>훈민정음을 만든 목적은?</h3>
        <div className="entry-answer-options">
          {[
            "백성의 의사소통을 돕기 위해",
            "신분에 따라 문자를 제한하기 위해",
          ].map((text, index) => (
            <button
              key={text}
              type="button"
              aria-pressed={answer === index}
              onClick={() => setAnswer(index)}
            >
              {text}
              <span aria-hidden="true">{answer === index ? "●" : "○"}</span>
            </button>
          ))}
        </div>
        <p className="entry-answer-feedback" aria-live="polite">
          {answer === null
            ? "자료 속 근거를 떠올려 보세요."
            : answer === 0
              ? "맞아요. ‘생각을 쉽게 표현’한다는 부분이 근거예요."
              : "‘쉽게 표현’한다는 목적에 다시 주목해 보세요."}
        </p>
        <div className="entry-confirmation">
          <div className="entry-demo-top">
            <strong>성적 확인 절차</strong>
            <span>가상 예시</span>
          </div>
          <div className="entry-confirm-steps" aria-label="성적 확인 절차 예시">
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                aria-pressed={step === index}
                onClick={() => setStep(index)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <p aria-live="polite">
            {
              [
                "평가 항목과 채점 내용을 내 답안과 비교합니다.",
                "답안지 확인을 요청하거나 이의를 제기하고, 처리 후 점수를 다시 확인합니다.",
                "내용을 확인한 뒤 성적 확인 서명을 남깁니다.",
              ][step]
            }
          </p>
        </div>
      </div>
    </FeatureScene>
  );
}

export function GrowthScene() {
  const [exam, setExam] = useState(80);
  const total = exam * 0.6 + 90 * 0.4;
  return (
    <FeatureScene
      id="entry-growth"
      number="05"
      label="평가 관리 · 성적 그래프"
      title="배움의 변화가,"
      accent="눈에 보이도록."
      description="평가 반영 비율에 맞춰 내 점수를 입력하면 그래프와 합산 점수가 바로 바뀝니다. 무엇을 보완할지 살피고, 다음 공부의 우선순위를 스스로 정해 봅니다."
    >
      <div className="entry-demo entry-growth-demo">
        <div className="entry-demo-top">
          <strong>나의 성적 계산기</strong>
          <span>가상 점수</span>
        </div>
        <div className="entry-score-total">
          <span>역사 · 반영 점수</span>
          <output aria-live="polite">
            {total.toFixed(1)}
            <small> / 100</small>
          </output>
        </div>
        <div
          className="entry-chart"
          role="img"
          aria-label={
            "정기시험 반영 " +
            (exam * 0.6).toFixed(1) +
            "점, 수행평가 반영 36점, 합계 " +
            total.toFixed(1) +
            "점"
          }
        >
          <span style={{ width: exam * 0.6 + "%" }} />
          <span style={{ width: "36%" }} />
        </div>
        <div className="entry-chart-legend">
          <span>정기시험 60%</span>
          <span>수행평가 40%</span>
        </div>
        <label className="entry-range-label" htmlFor="entry-exam">
          정기시험 점수 <strong>{exam}점</strong>
        </label>
        <input
          id="entry-exam"
          type="range"
          min="0"
          max="100"
          value={exam}
          onChange={(event) => setExam(Number(event.target.value))}
        />
        <p className="entry-demo-note">
          수행평가 90점으로 계산한 예시입니다. 공식 성적이 아닙니다.
        </p>
      </div>
    </FeatureScene>
  );
}

export function RecordScene() {
  return (
    <section
      id="entry-record"
      tabIndex={-1}
      className="entry-record"
      aria-labelledby="entry-record-title"
    >
      <div className="entry-heading">
        <p className="entry-eyebrow">
          <span>07</span> 마이페이지
        </p>
        <h2 id="entry-record-title">
          오늘의 탐구가,
          <br />
          <span className="entry-accent">내일의 생각으로.</span>
        </h2>
        <p className="entry-benefit">
          학습 현황, 평가 기록, 퀴즈 성장 그래프를 한곳에서 돌아봅니다. 아직
          살펴보지 않은 자료와 다시 확인할 내용을 찾아, 다음 배움을 이어 갑니다.
        </p>
      </div>
      <ol className="entry-record-path">
        <li>
          <span>수업 자료 · 개념 복습</span>
          <strong>놓친 내용을 다시</strong>
        </li>
        <li>
          <span>응시 기록 · 오답 리뷰</span>
          <strong>틀린 이유를 확인</strong>
        </li>
        <li>
          <span>목표 · 성장 그래프</span>
          <strong>다음 공부를 계획</strong>
        </li>
      </ol>
    </section>
  );
}
