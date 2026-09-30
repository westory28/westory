import React, { useEffect, useRef } from "react";
import dashboardDesktop from "../../assets/public-entry/dashboard-desktop.webp";
import dashboardMobile from "../../assets/public-entry/dashboard-mobile.webp";
import lessonDesktop from "../../assets/public-entry/lesson-desktop.webp";
import lessonMobile from "../../assets/public-entry/lesson-mobile.webp";
import scoreDesktop from "../../assets/public-entry/score-desktop.webp";
import scoreMobile from "../../assets/public-entry/score-mobile.webp";
import weplayDesktop from "../../assets/public-entry/weplay-desktop.webp";
import weplayMobile from "../../assets/public-entry/weplay-mobile.webp";
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

function Screen({
  desktop,
  mobile,
  alt,
  eager = false,
  className = "",
}: {
  desktop: string;
  mobile: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  const desktopSize = desktop === weplayDesktop ? [1000, 380] : [1280, 800];
  const mobileSize =
    desktop === weplayDesktop
      ? [537, 570]
      : desktop === scoreDesktop
        ? [537, 952]
        : [585, 1266];
  return (
    <picture className={"entry-screen " + className}>
      <source
        media="(max-width: 767px)"
        srcSet={mobile}
        width={mobileSize[0]}
        height={mobileSize[1]}
      />
      <img
        src={desktop}
        alt={alt}
        width={desktopSize[0]}
        height={desktopSize[1]}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
      />
    </picture>
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
  const assembly = useRef<HTMLElement>(null);
  const game = useRef<HTMLDivElement>(null);
  const dismissDialog = useRef(onDialogDismiss);
  dismissDialog.current = onDialogDismiss;
  const label = busy
    ? "처리 중..."
    : signedIn
      ? "계속하기"
      : "Google 학생 로그인";

  useEffect(() => {
    const element = root.current;
    const assemble = assembly.current;
    const gameElement = game.current;
    if (
      !element ||
      !assemble ||
      !gameElement ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia(
      "(min-width: 1024px) and (min-height: 600px)",
    );
    let assembleVisible = false;
    let gamePlayed = false;
    let frame = 0;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const updateAssembly = () => {
      frame = 0;
      if (preference.matches || !desktop.matches || !assembleVisible) return;
      const rect = assemble.getBoundingClientRect();
      const progress = clamp(
        (window.innerHeight * 0.15 - rect.top) /
          Math.max(1, rect.height - window.innerHeight * 0.85),
      );
      assemble.style.setProperty("--entry-progress", String(progress));
    };
    const requestAssembly = () => {
      if (
        !frame &&
        assembleVisible &&
        !preference.matches &&
        desktop.matches &&
        !document.hidden
      )
        frame = window.requestAnimationFrame(updateAssembly);
    };
    const syncMotion = () => {
      element.dataset.motion = preference.matches ? "off" : "on";
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (preference.matches && gamePlayed)
        gameElement.dataset.finished = "true";
      assemble.style.setProperty("--entry-progress", "1");
      requestAssembly();
    };
    const updateVisibility = () => {
      element.dataset.pageVisible = String(!document.hidden);
      if (document.hidden && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else requestAssembly();
    };
    const sceneObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.revealed = "true";
            sceneObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    const assemblyObserver = new IntersectionObserver(([entry]) => {
      assembleVisible = entry.isIntersecting;
      if (assembleVisible) requestAssembly();
      else if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    const gameObserver = new IntersectionObserver(
      ([entry]) => {
        gameElement.dataset.inView = String(entry.isIntersecting);
        if (entry.isIntersecting && !gamePlayed && !preference.matches) {
          gamePlayed = true;
          gameElement.dataset.played = "true";
        }
      },
      { threshold: 0.25 },
    );
    element
      .querySelectorAll<HTMLElement>("[data-entry-reveal]")
      .forEach((node) => sceneObserver.observe(node));
    assemblyObserver.observe(assemble);
    gameObserver.observe(gameElement);
    window.addEventListener("scroll", requestAssembly, { passive: true });
    window.addEventListener("resize", requestAssembly, { passive: true });
    document.addEventListener("visibilitychange", updateVisibility);
    const listen = (query: MediaQueryList) => {
      if (query.addEventListener) query.addEventListener("change", syncMotion);
      else query.addListener?.(syncMotion);
    };
    const unlisten = (query: MediaQueryList) => {
      if (query.removeEventListener)
        query.removeEventListener("change", syncMotion);
      else query.removeListener?.(syncMotion);
    };
    listen(preference);
    listen(desktop);
    updateVisibility();
    syncMotion();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      sceneObserver.disconnect();
      assemblyObserver.disconnect();
      gameObserver.disconnect();
      window.removeEventListener("scroll", requestAssembly);
      window.removeEventListener("resize", requestAssembly);
      document.removeEventListener("visibilitychange", updateVisibility);
      unlisten(preference);
      unlisten(desktop);
    };
  }, []);

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
        <section className="entry-hero" aria-labelledby="entry-title">
          <h1 id="entry-title">
            우리가 써 내려가는
            <br />
            <span className="entry-story">
              이야기.
              <svg aria-hidden="true" viewBox="0 0 300 18">
                <path
                  pathLength="1"
                  d="M5 12 C65 3 130 4 185 9 S255 12 295 5"
                />
              </svg>
            </span>
          </h1>
          <p className="entry-subtitle">수업부터 기록까지, 위스토리에서.</p>
          <div className="entry-login entry-first-login">
            {controls}
            {teacher}
          </div>
          <div className="entry-hero-screen">
            <Screen
              desktop={dashboardDesktop}
              mobile={dashboardMobile}
              eager
              alt="가상 데이터로 촬영한 실제 위스토리 학생 홈: 공지와 주간 일정"
            />
          </div>
        </section>

        <section
          ref={assembly}
          className="entry-assembly"
          aria-labelledby="entry-today-title"
          style={
            {
              "--entry-dashboard": "url(" + dashboardDesktop + ")",
            } as React.CSSProperties
          }
        >
          <div className="entry-assembly-stick">
            <div className="entry-heading" data-entry-reveal>
              <p className="entry-eyebrow">오늘의 위스토리</p>
              <h2 id="entry-today-title">
                오늘 필요한 것만,
                <br />
                한눈에.
              </h2>
            </div>
            <div className="entry-assembled-screen">
              <Screen
                desktop={dashboardDesktop}
                mobile={dashboardMobile}
                alt="공지와 이번 주 일정이 한 화면에 모인 실제 학생 홈 미리보기"
              />
              <div className="entry-fragments" aria-hidden="true">
                <div className="entry-fragment entry-fragment-notice" />
                <div className="entry-fragment entry-fragment-week" />
                <div className="entry-fragment entry-fragment-learning" />
              </div>
              <svg
                className="entry-outline"
                aria-hidden="true"
                viewBox="0 0 1000 625"
                preserveAspectRatio="none"
              >
                <rect
                  x="3"
                  y="3"
                  width="994"
                  height="619"
                  rx="16"
                  pathLength="1"
                />
              </svg>
            </div>
          </div>
        </section>

        <section
          className="entry-learning entry-section"
          aria-labelledby="entry-learning-title"
        >
          <div className="entry-heading" data-entry-reveal>
            <p className="entry-eyebrow">학습과 기록</p>
            <h2 id="entry-learning-title">
              배우고, <br />
              확인하고, <br />
              <span>기록하다.</span>
            </h2>
            <p className="entry-description">
              수업에서 시작한 배움이
              <br />
              나의 기록으로 이어집니다.
            </p>
          </div>
          <div className="entry-learning-screens">
            <figure data-entry-reveal>
              <Screen
                desktop={lessonDesktop}
                mobile={lessonMobile}
                alt="실제 수업 자료 화면에 가상 역사 수업 내용을 넣은 학습 미리보기"
              />
              <figcaption>수업 자료</figcaption>
            </figure>
            <figure data-entry-reveal>
              <Screen
                desktop={scoreDesktop}
                mobile={scoreMobile}
                alt="가상 평가 결과로 촬영한 실제 나의 성적 화면"
              />
              <figcaption>나의 성적과 기록</figcaption>
            </figure>
          </div>
        </section>

        <section
          className="entry-play entry-section"
          aria-labelledby="entry-play-title"
        >
          <div className="entry-heading" data-entry-reveal>
            <p className="entry-eyebrow">위플레이</p>
            <h2 id="entry-play-title">
              배운 역사가,
              <br />
              <span>플레이가 되다.</span>
            </h2>
            <p className="entry-description">내가 충무공이라고?!</p>
          </div>
          <div
            ref={game}
            className="entry-game-preview"
            onAnimationEnd={(event) => {
              if (event.animationName === "entry-word")
                event.currentTarget.dataset.finished = "true";
            }}
          >
            <Screen
              desktop={weplayDesktop}
              mobile={weplayMobile}
              alt="실제 위플레이 해전 화면의 정지 미리보기: 함선과 단어 장전"
            />
            <div className="entry-game-demo" aria-hidden="true">
              <span className="entry-game-word entry-game-word-first">
                거북선
              </span>
              <span className="entry-game-word entry-game-word-second">
                한산도
              </span>
              <span className="entry-game-answer">거북선</span>
            </div>
            <span className="entry-preview-label">게임 미리보기</span>
          </div>
        </section>

        <section
          className="entry-finish entry-section"
          aria-labelledby="entry-finish-title"
        >
          <Wordmark />
          <h2 id="entry-finish-title">이제, 나의 위스토리로.</h2>
          <button
            type="button"
            className="entry-primary"
            onClick={onStudentLogin}
            disabled={disabled}
          >
            {label}
          </button>
          <p className="entry-school">
            학교 Google 계정(@{schoolDomain})으로 이용할 수 있습니다.
          </p>
          {teacher}
        </section>
      </main>
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
