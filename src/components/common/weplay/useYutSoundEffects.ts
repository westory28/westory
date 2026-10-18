import { useCallback } from "react";
import useWeplaySoundEffects from "./useWeplaySoundEffects";

/** Shares the existing mute, gesture, visibility and bounded-voice lifecycle. */
export default function useYutSoundEffects() {
  const { play, unlock } = useWeplaySoundEffects();
  const toss = useCallback(
    (power = 0.65) =>
      play("yut-throw", 1.1 - Math.max(0, Math.min(1, power)) * 0.2),
    [play],
  );
  const impact = useCallback(
    (index = 0) => play("yut-impact", [0.94, 1.08, 0.99, 1.14][index % 4]),
    [play],
  );
  const step = useCallback(
    (index = 0) => play("yut-step", [1, 1.06, 1.12, 1.06, 1.16][index % 5]),
    [play],
  );
  const applause = useCallback(() => play("yut-applause"), [play]);
  return { throw: toss, impact, step, applause, unlock };
}
