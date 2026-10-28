import React, {
  forwardRef,
  useEffect,
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
  rotate(direction: "left" | "right"): void;
  zoom(direction: "in" | "out"): void;
  resetView(): void;
  focusFace(): void;
  animateOnce(durationMs?: number): void;
  stop(): void;
}

/** No renderer import or model request occurs before explicit activation. */
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
        getController: () => stageRef.current,
        capture: () => stageRef.current?.capture() ?? null,
        rotate: (direction) => stageRef.current?.rotate(direction),
        zoom: (direction) => stageRef.current?.zoom(direction),
        resetView: () => stageRef.current?.resetView(),
        focusFace: () => stageRef.current?.focusFace(),
        animateOnce: (duration) => stageRef.current?.animateOnce(duration),
        stop: () => stageRef.current?.stop(),
      }),
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
      setError(null);
      setLoading(true);
      callbacksRef.current.onLoadingChange?.(true);
      void import("./renderer/engine.js")
        .then(async ({ createAvatarStage }) => {
          if (abort.signal.aborted) return null;
          return createAvatarStage(container, lookRef.current, {
            signal: abort.signal,
            assetBaseUrl: `${import.meta.env.BASE_URL}avatar/v1/`,
            maxPixelRatio: 1.5,
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
          // A look can change while its GLB is still decoding.
          created.setLook(lookRef.current);
          setLoading(false);
          callbacksRef.current.onLoadingChange?.(false);
          callbacksRef.current.onReady?.(created);
        })
        .catch((cause: unknown) => {
          if (abort.signal.aborted) return;
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
        abort.abort();
        controller?.dispose();
        if (stageRef.current === controller) stageRef.current = null;
      };
    }, [active, documentVisible, look.character, retry]);

    useEffect(() => {
      stageRef.current?.setLook(look);
    }, [look]);

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
