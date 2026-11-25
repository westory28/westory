import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getWeplayIntroAudioState,
  subscribeWeplayIntroAudio,
} from "./weplayIntroAudio";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
  setWeplayAudioMuted,
} from "./weplayAudioPreference";

let audiblePlayer: HTMLAudioElement | null = null;

const savesData = () =>
  Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData,
  );

export interface WeplayMusicOptions {
  /** Compact file; the same name with .wav is the original it falls back to. */
  source?: string;
  volume?: number;
  /** Opening the game is the request to hear it: no further button is needed. */
  autoStart?: boolean;
}

export default function useWeplayMusic(
  active = true,
  {
    source = `${import.meta.env.BASE_URL}assets/weplay/naval/tide-of-victory.mp3?v=naval-war-2`,
    volume = 0.35,
    autoStart = false,
  }: WeplayMusicOptions = {},
) {
  const [muted, setMuted] = useState(isWeplayAudioMuted);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const intro = useSyncExternalStore(
    subscribeWeplayIntroAudio,
    getWeplayIntroAudioState,
  );
  const audio = useRef<HTMLAudioElement | null>(null);
  const wanted = useRef(false);
  const muteRef = useRef(muted);
  const alive = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const playerFor = useCallback(() => {
    if (audio.current) return audio.current;
    const player = new Audio(source);
    player.preload = "auto";
    player.loop = true;
    player.volume = volume;
    player.onerror = () => {
      if (audio.current !== player) return;
      // A device without the compact format plays the original recording.
      if (/\.mp3(?:\?|$)/.test(player.src)) {
        player.src = player.src.replace(/\.mp3(?=\?|$)/, ".wav");
        if (wanted.current) playRef.current();
        return;
      }
      if (activeRef.current && alive.current && !muteRef.current)
        setFailed(true);
    };
    return (audio.current = player);
  }, [source, volume]);
  const playRef = useRef<() => void>(() => {});
  const play = useCallback(() => {
    if (
      !activeRef.current ||
      !alive.current ||
      !wanted.current ||
      muteRef.current ||
      document.hidden ||
      getWeplayIntroAudioState().active
    )
      return;
    const player = playerFor();
    // A mounted preview or a route transition must not leave two scores playing.
    if (audiblePlayer && audiblePlayer !== player) audiblePlayer.pause();
    audiblePlayer = player;
    if (player.error) player.load();
    void player.play().then(
      () => {
        if (
          !activeRef.current ||
          !alive.current ||
          muteRef.current ||
          document.hidden ||
          getWeplayIntroAudioState().active ||
          audiblePlayer !== player ||
          audio.current !== player
        )
          player.pause();
        else setFailed(false);
      },
      (error: unknown) => {
        // Pausing while the sound was still loading is not a failure.
        if ((error as { name?: string })?.name === "AbortError") return;
        if (
          activeRef.current &&
          alive.current &&
          !muteRef.current &&
          !document.hidden &&
          !getWeplayIntroAudioState().active &&
          audio.current === player &&
          audiblePlayer === player
        )
          setFailed(true);
      },
    );
  }, [playerFor]);
  playRef.current = play;
  const start = useCallback(() => {
    wanted.current = true;
    setStarted(true);
    play();
  }, [play]);
  const toggle = () => {
    const nextMuted = intro.active
      ? intro.audible && !muted
      : started && !muted && !failed;
    muteRef.current = nextMuted;
    setMuted(nextMuted);
    setFailed(false);
    setWeplayAudioMuted(nextMuted);
    if (nextMuted) audio.current?.pause();
    else if (!intro.active) start();
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = onWeplayAudioMutedChange((nextMuted) => {
      if (muteRef.current === nextMuted) return;
      muteRef.current = nextMuted;
      setMuted(nextMuted);
      if (nextMuted) audio.current?.pause();
      else play();
    });
    const visibility = () => {
      if (document.hidden) audio.current?.pause();
      else play();
    };
    // The browser may refuse sound before the first touch, and the device may
    // stop it (a call, another app, unplugged headphones). The next touch or key
    // continues it. The sound button decides for itself.
    const gesture = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".weplay-music-button, [data-weplay-sound]")
      )
        return;
      if (wanted.current && (!audio.current || audio.current.paused)) play();
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", gesture, true);
    document.addEventListener("keydown", gesture, true);
    return () => {
      alive.current = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", gesture, true);
      document.removeEventListener("keydown", gesture, true);
      audio.current?.pause();
      if (audiblePlayer === audio.current) audiblePlayer = null;
      if (audio.current) audio.current.onerror = null;
      audio.current?.removeAttribute("src");
      audio.current?.load();
      audio.current = null;
    };
  }, [play]);
  useEffect(() => {
    if (!active || !autoStart) return;
    wanted.current = true;
    setStarted(true);
    // Fetched while the opening is shown, so the music is there when it ends.
    if (!muteRef.current && !savesData()) playerFor();
  }, [active, autoStart, playerFor]);
  useEffect(() => {
    if (active && !intro.active) play();
    else audio.current?.pause();
  }, [active, autoStart, intro.active, play]);
  return {
    start,
    toggle,
    enabled: intro.active
      ? intro.audible && !muted
      : started && !muted && !failed,
    failed: intro.active ? false : failed,
  };
}
