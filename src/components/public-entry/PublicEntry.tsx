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
import { Device, FinaleTitle, MotionTitle, StoryLink } from "./EntryVisuals";
import EntryPlayScene from "./EntryPlayScene";
import EntryMyPageScene from "./EntryMyPageScene";
import EntryRibbon from "./EntryRibbon";
import { useEntryMotion } from "./useEntryMotion";
import "./public-entry.css";
import "./entry-story-scenes.css";
import "./entry-detail.css";
import "./entry-space.css";
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
            <EntryRibbon variant="hero" />
            <div className="entry-hero-copy" data-entry-reveal>
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
              <div className="entry-login entry-first-login">{controls}</div>
            </div>
            <div className="entry-hero-visual">
              <Device kind="tablet" className="entry-hero-tablet">
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
            <EntryRibbon variant="wide" />
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
            <EntryRibbon variant="finish" />
            <p className="entry-eyebrow">함께 써 내려갈 다음 장</p>
            <FinaleTitle />
            <div className="entry-login-actions entry-finish-actions">
              <button
                type="button"
                className="entry-primary"
                onClick={onStudentLogin}
                disabled={disabled}
              >
                {label}
                <span aria-hidden="true"> ↗</span>
              </button>
              {teacher}
            </div>
            <p className="entry-school">
              학교 Google 계정(@{schoolDomain})으로 이용할 수 있습니다.
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
