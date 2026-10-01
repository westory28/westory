import React, { useEffect, useRef } from "react";
import dashboardDesktop from "../../assets/public-entry/dashboard-desktop.webp";
import lessonDesktop from "../../assets/public-entry/lesson-desktop.webp";
import {
  EntryOverview,
  MapScene,
  ThinkScene,
  CheckScene,
  GrowthScene,
  RecordScene,
} from "./EntryFeatureScenes";
import { useEntryMotion } from "./useEntryMotion";
import "./public-entry.css";

interface Props {
  controls: React.ReactNode;
  onStudentLogin: () => void;
  onTeacherLogin: () => void;
  onPolicy: (policy: "terms" | "privacy") => void;
  disabled: boolean;
  teacherDisabled?: boolean;
  busy: boolean;
  signedIn: boolean;
  activeDialog?: "policy" | "profile" | "consent" | null;
  onDialogDismiss?: () => void;
  schoolDomain: string;
}

function Wordmark() {
  return (
    <span className="entry-wordmark" aria-label="Westory">
      <span>We</span>
      <span>story</span>
    </span>
  );
}

/** Crop existing synthetic captures into independent visual layers. */
function Crop({
  src,
  box,
  alt,
  eager = false,
}: {
  src: string;
  box: [number, number, number, number];
  alt: string;
  eager?: boolean;
}) {
  const [x, y, width, height] = box;
  return (
    <div className="entry-crop" style={{ aspectRatio: width + " / " + height }}>
      <img
        src={src}
        alt={alt}
        width="1280"
        height="800"
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...{ fetchpriority: eager ? "high" : "auto" }}
        style={{
          width: (1280 / width) * 100 + "%",
          left: (-x / width) * 100 + "%",
          top: (-y / height) * 100 + "%",
        }}
      />
    </div>
  );
}

function DayPanels({ hero = false }: { hero?: boolean }) {
  return (
    <div
      className={"entry-day-panels" + (hero ? " entry-day-panels--hero" : "")}
    >
      <div className="entry-day-week">
        <Crop
          src={dashboardDesktop}
          box={[256, 80, 520, 660]}
          eager={hero}
          alt="예시 화면: 이번 주 학사 일정"
        />
      </div>
      <div className="entry-day-notice">
        <Crop
          src={dashboardDesktop}
          box={[792, 80, 464, 316]}
          eager={hero}
          alt="예시 화면: 알림장"
        />
      </div>
      <div className="entry-day-ranking">
        <Crop
          src={dashboardDesktop}
          box={[792, 412, 464, 328]}
          eager={hero}
          alt="예시 화면: 위스 랭킹"
        />
      </div>
    </div>
  );
}

/** Presentation only: no application, auth, database or game imports. */
export default function PublicEntry({
  controls,
  onStudentLogin,
  onTeacherLogin,
  onPolicy,
  disabled,
  teacherDisabled,
  busy,
  signedIn,
  activeDialog = null,
  onDialogDismiss,
  schoolDomain,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const lastPageFocus = useRef<HTMLElement | null>(null);
  const dismissDialog = useRef(onDialogDismiss);
  dismissDialog.current = onDialogDismiss;
  const label = busy
    ? "처리 중..."
    : signedIn
      ? "계속하기"
      : "Google 학생 로그인";

  useEntryMotion(root);

  useEffect(() => {
    const page = root.current;
    if (!page || !activeDialog) return;
    const previous = page.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : lastPageFocus.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    page.setAttribute("inert", "");
    const dialog = page.parentElement?.querySelector<HTMLElement>(
      '[data-login-dialog="' + activeDialog + '"]',
    );
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]",
        ) || [],
      ).filter(
        (node) => node.tabIndex >= 0 && node.getClientRects().length > 0,
      );
    const frame = window.requestAnimationFrame(() => focusables()[0]?.focus());
    const trap = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismissDialog.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      window.cancelAnimationFrame(frame);
      page.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trap);
      window.requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      });
    };
  }, [activeDialog]);

  const teacher = (
    <button
      type="button"
      className="entry-text-button"
      onClick={onTeacherLogin}
      disabled={teacherDisabled ?? disabled}
    >
      관리자 로그인
    </button>
  );
  return (
    <div
      ref={root}
      className="public-entry"
      onFocusCapture={(event) => {
        lastPageFocus.current = event.target as HTMLElement;
      }}
    >
      <header className="entry-header">
        <Wordmark />
        <button
          type="button"
          className="entry-primary entry-header-login"
          onClick={onStudentLogin}
          disabled={disabled}
        >
          {busy ? "처리 중..." : signedIn ? "계속하기" : "학생 로그인"}
        </button>
      </header>
      <main>
        <section
          className="entry-hero entry-scene"
          data-entry-scene
          aria-labelledby="entry-title"
        >
          <div className="entry-stage entry-hero-stage">
            <div className="entry-hero-copy">
              <p className="entry-eyebrow">수업부터 기록까지, 위스토리</p>
              <h1 id="entry-title" tabIndex={-1}>
                <span>역사를 읽고,</span>
                <br />
                <span className="entry-story">나의 생각으로.</span>
              </h1>
              <p className="entry-benefit">
                자료 속 근거를 찾고, 서로의 관점을 만나고.
                <br />
                배움의 변화를 확인하는 나만의 역사 교실.
              </p>
              <div className="entry-login entry-first-login">
                {controls}
                {teacher}
              </div>
            </div>
            <div className="entry-hero-visual">
              <DayPanels hero />
            </div>
            <span className="entry-scroll-cue" aria-hidden="true">
              SCROLL TO EXPLORE <span>↓</span>
            </span>
          </div>
        </section>
        <section
          className="entry-structure"
          aria-labelledby="entry-structure-title"
        >
          <div className="entry-heading">
            <p className="entry-eyebrow">위스토리 한눈에 보기</p>
            <h2 id="entry-structure-title">
              수업의 시작부터,
              <br />
              <span className="entry-accent">나의 성장까지.</span>
            </h2>
            <p className="entry-benefit">
              오늘의 공지와 일정에서 출발해, 탐구하고 확인하고 돌아보는 흐름.
              흩어진 학습 경험을 한곳에서 연결합니다.
            </p>
          </div>
          <EntryOverview />
        </section>
        <section
          id="entry-lesson"
          tabIndex={-1}
          className="entry-learning entry-scene"
          data-entry-scene
          aria-labelledby="entry-learning-title"
        >
          <div className="entry-stage entry-split-stage">
            <div className="entry-heading">
              <p className="entry-eyebrow">
                <span>01</span> 수업 자료
              </p>
              <h2 id="entry-learning-title">
                <span className="entry-line">읽고, 채우고.</span>

                <span className="entry-line entry-accent">근거를 찾다.</span>
              </h2>
              <p className="entry-benefit">
                본문과 영상으로 내용을 읽고, PDF 학습지의 빈칸을 채우며 이해를
                확인합니다. 참고자료를 오가며 내 답을 뒷받침할 근거를
                찾아갑니다.
              </p>
            </div>
            <div className="entry-learning-visual">
              <figure className="entry-lesson-panel">
                <figcaption>
                  수업 자료 <span>↗</span>
                </figcaption>
                <Crop
                  src={lessonDesktop}
                  box={[584, 104, 664, 676]}
                  alt="예시 수업 자료: 조선의 문화와 훈민정음"
                />
              </figure>
              <figure className="entry-score-panel entry-source-note">
                <figcaption>
                  자료에서 생각으로 <span>↗</span>
                </figcaption>
                <blockquote>
                  “백성을 위한
                  <br />
                  새로운 문자”
                </blockquote>
                <p>
                  누구를 위한 변화였을까?
                  <br />
                  자료 속 표현에서 근거를 찾아보세요.
                </p>
              </figure>
            </div>
            <div className="entry-scene-track" aria-hidden="true">
              <span />
            </div>
          </div>
        </section>
        <MapScene />
        <ThinkScene />
        <CheckScene />
        <GrowthScene />
        <section
          id="entry-game"
          tabIndex={-1}
          className="entry-play entry-scene"
          data-entry-scene
          aria-labelledby="entry-play-title"
        >
          <div className="entry-stage entry-play-stage">
            <div className="entry-heading">
              <p className="entry-eyebrow">
                <span>06</span> 위플레이
              </p>
              <h2 id="entry-play-title">
                <span className="entry-line">배운 역사 용어,</span>
                <span className="entry-line entry-accent">
                  플레이로 한 번 더.
                </span>
              </h2>
              <p className="entry-benefit">
                역사 단어를 입력해 화포를 발사하는 ‘내가 충무공이라고?!’. 연습과
                도전으로 수업에서 만난 용어를 다시 떠올립니다.
              </p>
            </div>
            <div
              className="entry-ocean"
              role="img"
              aria-label="위플레이 내가 충무공이라고?! 게임 아트: 바다를 가르는 거북선"
            >
              <img
                className="entry-sea"
                src={
                  import.meta.env.BASE_URL +
                  "assets/weplay/naval/sea-battle.webp"
                }
                alt=""
                loading="lazy"
              />
              <span className="entry-sea-wash" />
              <img
                className="entry-ship"
                src={
                  import.meta.env.BASE_URL +
                  "assets/weplay/naval/allied-ship.webp"
                }
                alt=""
                loading="lazy"
              />
              <span
                className="entry-play-word entry-play-word--one"
                aria-hidden="true"
              >
                한산도
              </span>
              <span
                className="entry-play-word entry-play-word--two"
                aria-hidden="true"
              >
                거북선
              </span>
            </div>
            <p className="entry-play-caption">
              내가 충무공이라고?! <span>위플레이</span>
            </p>
            <div className="entry-scene-track" aria-hidden="true">
              <span />
            </div>
          </div>
        </section>
        <RecordScene />
        <section className="entry-finish" aria-labelledby="entry-finish-title">
          <p className="entry-eyebrow">다음 이야기는, 너로부터.</p>
          <h2 id="entry-finish-title">
            이제, 나의
            <br />
            <span className="entry-accent">위스토리로.</span>
          </h2>
          <button
            type="button"
            className="entry-primary"
            onClick={onStudentLogin}
            disabled={disabled}
          >
            {label}
            <span aria-hidden="true"> ↗</span>
          </button>
          <p className="entry-school">
            학교 Google 계정(@{schoolDomain})으로 이용할 수 있습니다.
          </p>
          {teacher}
        </section>
      </main>
      <button
        type="button"
        className="entry-back-top"
        aria-label="맨 위로 가기"
        title="맨 위로 가기"
        onClick={() => {
          root.current
            ?.querySelector<HTMLElement>("#entry-title")
            ?.focus({ preventScroll: true });
          window.scrollTo({
            top: 0,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
          });
        }}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <footer className="entry-footer">
        <button type="button" onClick={() => onPolicy("terms")}>
          이용 약관
        </button>
        <button type="button" onClick={() => onPolicy("privacy")}>
          개인정보 처리 방침
        </button>
      </footer>
    </div>
  );
}
