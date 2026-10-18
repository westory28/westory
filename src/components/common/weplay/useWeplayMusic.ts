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

export default function useWeplayMusic(
  active = true,
  source = `${import.meta.env.BASE_URL}assets/weplay/naval/tide-of-victory.wav?v=naval-war-2`,
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
    const player = (audio.current ||= new Audio(source));
    // A mounted preview or a route transition must not leave two scores playing.
    if (audiblePlayer && audiblePlayer !== player) audiblePlayer.pause();
    audiblePlayer = player;
    player.loop = true;
    player.volume = 0.28;
    player.onerror = () => {
      if (
        audio.current === player &&
        activeRef.current &&
        alive.current &&
        !muteRef.current
      )
        setFailed(true);
    };
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
      () => {
        if (
          activeRef.current &&
          alive.current &&
          !muteRef.current &&
          !document.hidden &&
          audio.current === player &&
          audiblePlayer === player
        )
          setFailed(true);
      },
    );
  }, [source]);
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
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      audio.current?.pause();
      if (audiblePlayer === audio.current) audiblePlayer = null;
      if (audio.current) audio.current.onerror = null;
      audio.current?.removeAttribute("src");
      audio.current?.load();
      audio.current = null;
    };
  }, [play]);
  useEffect(() => {
    if (active && !intro.active) play();
    else audio.current?.pause();
  }, [active, intro.active, play]);
  return {
    start,
    toggle,
    enabled: intro.active
      ? intro.audible && !muted
      : started && !muted && !failed,
    failed: intro.active ? false : failed,
  };
}
