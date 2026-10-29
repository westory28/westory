import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AvatarLook } from "./catalog";
import type { AvatarStageController } from "./renderer/types";

export interface AvatarStageProps {
  look: AvatarLook;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
  onReady?: (controller: AvatarStageController) => void;
  onError?: (error: Error) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export interface AvatarStageHandle {
  getController(): AvatarStageController | null;
  capture(): string | null;
  zoom(direction: "in" | "out"): void;
  resetView(): void;
  focusFace(): void;
  animateOnce(durationMs?: number): void;
  stop(): void;
}

/** Load the illustrated layers only when the studio is visible and active. */
export const AvatarStage = forwardRef<AvatarStageHandle, AvatarStageProps>(
  function AvatarStage(
    {
      look,
      active = false,
      className,
      style,
      onReady,
      onError,
      onLoadingChange,
    },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<AvatarStageController | null>(null);
    const preparedRef = useRef(false);
    const selectionRef = useRef(0);
    const preparationAbortRef = useRef<AbortController | null>(null);
    const lookRef = useRef(look);
    const callbacksRef = useRef({ onReady, onError, onLoadingChange });
    const [documentVisible, setDocumentVisible] = useState(
      () => typeof document === "undefined" || !document.hidden,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    lookRef.current = look;
    callbacksRef.current = { onReady, onError, onLoadingChange };

    useEffect(() => {
      const update = () => setDocumentVisible(!document.hidden);
      document.addEventListener("visibilitychange", update);
      return () => document.removeEventListener("visibilitychange", update);
    }, []);

    useImperativeHandle(
      forwardedRef,
      () => ({
        getController: () => (preparedRef.current ? stageRef.current : null),
        capture: () =>
          preparedRef.current ? (stageRef.current?.capture() ?? null) : null,
        zoom: (direction) => stageRef.current?.zoom(direction),
        resetView: () => stageRef.current?.resetView(),
        focusFace: () => stageRef.current?.focusFace(),
        animateOnce: (duration) => stageRef.current?.animateOnce(duration),
        stop: () => stageRef.current?.stop(),
      }),
      [],
    );

    const applyLatestLook = useCallback(
      async (controller: AvatarStageController, candidate: AvatarLook) => {
        const selection = ++selectionRef.current;
        preparationAbortRef.current?.abort();
        const abort = new AbortController();
        preparationAbortRef.current = abort;
        preparedRef.current = false;
        setError(null);
        setLoading(true);
        callbacksRef.current.onLoadingChange?.(true);
        try {
          await controller.prepareLook(candidate, { signal: abort.signal });
          if (
            abort.signal.aborted ||
            selection !== selectionRef.current ||
            stageRef.current !== controller
          )
            return;
          const result = controller.setLook(candidate);
          if (!result.applied)
            throw new Error("선택한 아바타 모습을 적용하지 못했습니다.");
          preparedRef.current = true;
          setLoading(false);
          callbacksRef.current.onLoadingChange?.(false);
          callbacksRef.current.onReady?.(controller);
        } catch (cause: unknown) {
          if (
            abort.signal.aborted ||
            selection !== selectionRef.current ||
            stageRef.current !== controller
          )
            return;
          const failure =
            cause instanceof Error
              ? cause
              : new Error("아바타 그림을 불러오지 못했습니다.");
          preparedRef.current = false;
          setLoading(false);
          setError("아바타를 불러오지 못했습니다. 다시 시도해 주세요.");
          callbacksRef.current.onLoadingChange?.(false);
          callbacksRef.current.onError?.(failure);
        } finally {
          if (preparationAbortRef.current === abort)
            preparationAbortRef.current = null;
        }
      },
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!active || !documentVisible || !container) {
        setLoading(false);
        callbacksRef.current.onLoadingChange?.(false);
        return;
      }
      const abort = new AbortController();
      let controller: AvatarStageController | null = null;
      let requestedLook = lookRef.current;
      preparedRef.current = false;
      setError(null);
      setLoading(true);
      callbacksRef.current.onLoadingChange?.(true);
      void import("./renderer2d/engine")
        .then(async ({ createAvatarStage }) => {
          if (abort.signal.aborted) return null;
          requestedLook = lookRef.current;
          // The controller loads the shared art manifest first; selected layers
          // are prepared below so a newer selection can cancel stale requests.
          return createAvatarStage(container, requestedLook, {
            signal: abort.signal,
            assetBaseUrl: `${import.meta.env.BASE_URL}avatar/v2/`,
            maxPixelRatio: 1.5,
            deferPreparation: true,
          });
        })
        .then((created) => {
          if (!created) return;
          if (abort.signal.aborted) {
            created.dispose();
            return;
          }
          controller = created;
          stageRef.current = created;
          // A selection may have changed while the shared artwork loaded.
          void applyLatestLook(created, lookRef.current);
        })
        .catch((cause: unknown) => {
          if (abort.signal.aborted) return;
          if (requestedLook.hairStyle !== lookRef.current.hairStyle) {
            setRetry((value) => value + 1);
            return;
          }
          const failure =
            cause instanceof Error
              ? cause
              : new Error("아바타를 불러오지 못했습니다.");
          setLoading(false);
          setError("아바타를 불러오지 못했습니다. 다시 시도해 주세요.");
          callbacksRef.current.onLoadingChange?.(false);
          callbacksRef.current.onError?.(failure);
        });
      return () => {
        selectionRef.current++;
        preparedRef.current = false;
        preparationAbortRef.current?.abort();
        preparationAbortRef.current = null;
        abort.abort();
        controller?.dispose();
        if (stageRef.current === controller) stageRef.current = null;
      };
    }, [active, documentVisible, look.character, retry, applyLatestLook]);

    useLayoutEffect(() => {
      const controller = stageRef.current;
      if (active && documentVisible && controller?.character === look.character)
        void applyLatestLook(controller, look);
    }, [look, active, documentVisible, applyLatestLook]);

    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          ...style,
        }}
        aria-busy={loading}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {loading && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center text-sm text-slate-500"
          >
            아바타를 불러오는 중…
          </p>
        )}
        {error && active && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-4 text-center text-sm text-slate-600"
          >
            <p>{error}</p>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-slate-300 px-4 font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
    );
  },
);

export default AvatarStage;
