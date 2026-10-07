import { useCallback, useEffect, useRef, useState } from "react";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
  setWeplayAudioMuted,
} from "./weplayAudioPreference";

export default function useWeplayMusic() {
  const [muted, setMuted] = useState(isWeplayAudioMuted);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const wanted = useRef(false);
  const muteRef = useRef(muted);
  const alive = useRef(true);
  const play = useCallback(() => {
    if (!alive.current || !wanted.current || muteRef.current || document.hidden)
      return;
    const player = (audio.current ||= new Audio(
      `${import.meta.env.BASE_URL}assets/weplay/naval/tide-of-victory.wav`,
    ));
    player.loop = true;
    player.volume = 0.28;
    void player.play().then(
      () => {
        if (!alive.current || muteRef.current || document.hidden)
          player.pause();
        else setFailed(false);
      },
      () => {
        if (alive.current && !muteRef.current && !document.hidden)
          setFailed(true);
      },
    );
  }, []);
  const start = useCallback(() => {
    wanted.current = true;
    setStarted(true);
    play();
  }, [play]);
  const toggle = () => {
    const nextMuted = started && !muted && !failed;
    muteRef.current = nextMuted;
    setMuted(nextMuted);
    setFailed(false);
    setWeplayAudioMuted(nextMuted);
    if (nextMuted) audio.current?.pause();
    else start();
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
      audio.current?.removeAttribute("src");
      audio.current?.load();
      audio.current = null;
    };
  }, [play]);
  return { start, toggle, enabled: started && !muted && !failed, failed };
}
