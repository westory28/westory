import React, { useEffect, useRef, useState } from "react";
import {
  EntryOverview,
  LessonScene,
  MapScene,
  ThinkScene,
  CheckScene,
  GrowthScene,
  RecordScene,
} from "./EntryFeatureScenes";
import { FinaleTitle, MotionTitle, StoryLink } from "./EntryVisuals";
import EntryPlayScene from "./EntryPlayScene";
import EntryMyPageScene from "./EntryMyPageScene";
import EntryGlow from "./EntryGlow";
import EntryMobileDashboard from "./EntryMobileDashboard";
import EntryHeroLaptop from "./EntryHeroLaptop";
import { useEntryMotion } from "./useEntryMotion";
import { useEntryFinale } from "./useEntryFinale";
import {
  EntryMotionProvider,
  useEntryMotionEnabled,
} from "./EntryMotionContext";
import "./public-entry.css";
import "./entry-story-scenes.css";
import "./entry-detail.css";
import "./entry-space.css";
import "./entry-flow.css";
import "./entry-motion-control.css";
import "./entry-timing.css";
import "./entry-polish.css";
import "./entry-brand-motion.css";
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
export default function PublicEntry(props: Props) {
  const [motionEnabled, setMotionEnabled] = useState(true);
  return (
    <EntryMotionProvider enabled={motionEnabled}>
      <PublicEntryContent
        {...props}
        onToggleMotion={() => setMotionEnabled((enabled) => !enabled)}
      />
    </EntryMotionProvider>
  );
}

function PublicEntryContent({
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
  onToggleMotion,
}: Props & { onToggleMotion: () => void }) {
  const motionEnabled = useEntryMotionEnabled();
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
  useEntryFinale(root, Boolean(activeDialog) || busy);

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
      className="entry-secondary"
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
      data-motion={motionEnabled ? "on" : "off"}
      onFocusCapture={(event) => {
        lastPageFocus.current = event.target as HTMLElement;
      }}
    >
      <header className="entry-header">
        <Wordmark />
        <div className="entry-header-actions">
          <button
            type="button"
            className="entry-primary entry-header-login"
            onClick={onStudentLogin}
            disabled={disabled}
          >
            {busy ? "처리 중..." : signedIn ? "계속하기" : "학생 로그인"}
          </button>
          {teacher}
        </div>
      </header>
      <main>
        <section
          className="entry-hero entry-scene"
          data-entry-scene
          aria-labelledby="entry-title"
        >
          <div className="entry-stage entry-hero-stage">
            <EntryGlow variant="hero" />
            <div className="entry-hero-copy" data-entry-reveal>
              <h1
                id="entry-title"
                tabIndex={-1}
                aria-label="역사를 읽고, 생각을 연결하다"
              >
                <span className="entry-hero-mask" aria-hidden="true">
                  <span>역사를 읽고,</span>
                </span>
                <span className="entry-hero-mask" aria-hidden="true">
                  <span className="entry-hero-sentence">
                    <span className="entry-hero-thought">생각을</span>{" "}
                    <span className="entry-hero-connect">연결하다</span>
                  </span>
                </span>
              </h1>
              <p className="entry-benefit">
                자료 속 근거를 찾고, 서로의 관점을 만나고.
                <br />
                배움의 변화를 확인하는 우리의 역사 교실.
              </p>
              <div className="entry-login entry-first-login">{controls}</div>
            </div>
            <div className="entry-hero-visual">
              <EntryHeroLaptop />
              <EntryMobileDashboard className="entry-hero-phone" />
              <span className="entry-hero-annotation">
                한 장의 자료에서 시작되는 탐구
              </span>
            </div>
          </div>
        </section>
        <section
          className="entry-structure entry-scene"
          data-entry-scene
          aria-labelledby="entry-structure-title"
        >
          <div className="entry-stage">
            <EntryGlow variant="wide" />
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
        <RecordScene />
        <EntryPlayScene />
        <EntryMyPageScene />
        <section
          className="entry-finish entry-scene"
          data-entry-scene
          aria-labelledby="entry-finish-title"
        >
          <div className="entry-stage">
            <EntryGlow variant="finish" />
            <p className="entry-eyebrow">함께 써 내려갈 다음 장</p>
            <FinaleTitle />
            <div className="entry-login-actions entry-finish-actions">
              <button
                type="button"
                className="entry-primary"
                aria-label={label}
                onClick={onStudentLogin}
                disabled={disabled}
              >
                <svg
                  className="entry-google-icon"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="currentColor"
                    d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35ZM12 22c2.7 0 4.96-.9 6.61-2.42l-3.24-2.51c-.9.6-2.05.96-3.37.96-2.6 0-4.8-1.76-5.59-4.13H3.07v2.6A10 10 0 0 0 12 22ZM6.41 13.9a6 6 0 0 1 0-3.8V7.5H3.07a10 10 0 0 0 0 9l3.34-2.6ZM12 5.97c1.47 0 2.79.5 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.34 2.6A6.01 6.01 0 0 1 12 5.97Z"
                  />
                </svg>
                <span>
                  {label === "Google 학생 로그인" ? "학생 로그인" : label}
                </span>
              </button>
              {teacher}
            </div>
            <p className="entry-school">
              학교 Google 계정<span>(@{schoolDomain})</span>으로 이용할 수
              있습니다.
            </p>
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
            behavior: motionEnabled ? "smooth" : "auto",
          });
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="m4 13 6-6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <footer className="entry-footer">
        <Wordmark />
        <div className="entry-footer-actions">
          <button
            type="button"
            className="entry-motion-control"
            aria-label={motionEnabled ? "대문 모션 끄기" : "대문 모션 켜기"}
            aria-pressed={motionEnabled}
            onClick={onToggleMotion}
          >
            <span className="entry-motion-indicator" aria-hidden="true" />
            {motionEnabled ? "모션 끄기" : "모션 켜기"}
          </button>
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
