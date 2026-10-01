import React, { useEffect, useRef } from "react";
import lessonReal from "../../assets/public-entry/lesson-real.webp";
import mapReal from "../../assets/public-entry/map-real.webp";
import {
  EntryOverview,
  LessonScene,
  MapScene,
  ThinkScene,
  CheckScene,
  GrowthScene,
  RecordScene,
} from "./EntryFeatureScenes";
import { Device, MotionTitle, StoryLink } from "./EntryVisuals";
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
      <div className="entry-story-thread" aria-hidden="true">
        <svg viewBox="0 0 80 1800" preserveAspectRatio="none">
          <path
            className="entry-thread-base"
            d="M40 0 V90 C40 140 72 130 72 175 S12 225 12 270 V450 C12 500 64 500 64 550 V750 C64 800 16 820 16 880 V1100 C16 1180 66 1160 66 1240 V1500 C66 1560 40 1600 40 1660 V1800"
          />
          <path
            pathLength="1"
            className="entry-thread-draw"
            d="M40 0 V90 C40 140 72 130 72 175 S12 225 12 270 V450 C12 500 64 500 64 550 V750 C64 800 16 820 16 880 V1100 C16 1180 66 1160 66 1240 V1500 C66 1560 40 1600 40 1660 V1800"
          />
        </svg>
      </div>
      <main>
        <section
          className="entry-hero entry-scene"
          data-entry-scene
          aria-labelledby="entry-title"
        >
          <div className="entry-stage entry-hero-stage">
            <div className="entry-hero-copy">
              <p className="entry-eyebrow">함께 배우고, 스스로 생각하는 역사</p>
              <h1
                id="entry-title"
                tabIndex={-1}
                aria-label="역사를 읽고, 생각을 연결하다."
              >
                <span className="entry-hero-mask" aria-hidden="true">
                  <span>역사를 읽고,</span>
                </span>
                <span className="entry-hero-mask" aria-hidden="true">
                  <span>생각을 연결하다.</span>
                </span>
              </h1>
              <p className="entry-benefit">
                자료 속 근거를 찾고, 서로의 관점을 만나고.
                <br />
                배움의 변화를 확인하는 우리의 역사 교실.
              </p>
              <div className="entry-login entry-first-login">
                {controls}
                {teacher}
              </div>
            </div>
            <div className="entry-hero-visual">
              <span className="entry-visual-orbit" aria-hidden="true" />
              <Device kind="laptop" className="entry-hero-laptop">
                <img
                  src={lessonReal}
                  alt="실제 위스토리 빈칸 학습지 화면"
                  width="1340"
                  height="1050"
                  decoding="async"
                  {...{ fetchpriority: "high" }}
                />
              </Device>
              <Device kind="phone" className="entry-hero-phone">
                <div className="entry-phone-title">역사를 지도로</div>
                <img
                  src={mapReal}
                  alt="실제 제작 한반도 역사 지리 지도"
                  width="1037"
                  height="1383"
                  loading="lazy"
                />
              </Device>
              <span className="entry-hero-annotation">
                한 장의 자료에서 시작되는 탐구
              </span>
            </div>
            <span className="entry-scroll-cue" aria-hidden="true">
              이야기를 따라 내려가 보세요 <span>↓</span>
            </span>
          </div>
        </section>
        <section
          className="entry-structure entry-scene"
          data-entry-scene
          aria-labelledby="entry-structure-title"
        >
          <div className="entry-stage">
            <StoryLink number="WESTORY" label="한눈에 보는 위스토리" />
            <MotionTitle
              id="entry-structure-title"
              lines={["배움이 흩어지지 않도록.", "하나의 흐름으로."]}
            />
            <EntryOverview />
          </div>
        </section>
        <LessonScene />
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
          <div className="entry-stage">
            <div className="entry-heading">
              <StoryLink number="06" label="위플레이" />
              <MotionTitle
                id="entry-play-title"
                lines={["다시 만난 역사 용어,", "이번에는 플레이로."]}
              />
              <p className="entry-benefit">
                역사 단어를 입력해 화포를 발사하는 ‘내가 충무공이라고?!’.
                <br />
                도전하는 즐거움 속에서 수업의 기억을 다시 꺼냅니다.
              </p>
            </div>
            <div
              className="entry-ocean"
              role="img"
              aria-label="실제 위플레이 게임 아트: 바다를 가르는 거북선"
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
              <div className="entry-play-caption">
                <span>위플레이</span>
                <strong>내가 충무공이라고?!</strong>
              </div>
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
          </div>
        </section>
        <RecordScene />
        <section
          className="entry-finish entry-scene"
          data-entry-scene
          aria-labelledby="entry-finish-title"
        >
          <div className="entry-stage">
            <span className="entry-finish-dot" aria-hidden="true" />
            <p className="entry-eyebrow">함께 써 내려갈 다음 장</p>
            <MotionTitle
              id="entry-finish-title"
              lines={["이제 우리의 이야기로.", "위스토리"]}
            />
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
          </div>
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
        <Wordmark />
        <div>
          <button type="button" onClick={() => onPolicy("terms")}>
            이용 약관
          </button>
          <button type="button" onClick={() => onPolicy("privacy")}>
            개인정보 처리 방침
          </button>
        </div>
      </footer>
    </div>
  );
}
