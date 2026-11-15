import { useRef, useState } from "react";
import WeplayMusicButton from "../WeplayMusicButton";
import WeplayStudioIntro from "../WeplayStudioIntro";
import useWeplayMusic from "../useWeplayMusic";
import RhythmGame from "./RhythmGame";

/** The keyed entry owns one opening; the game mounts only after it finishes. */
export default function RhythmOpening({
  preview,
  playable,
}: {
  preview: boolean;
  playable: boolean;
}) {
  const [introduced, setIntroduced] = useState(false);
  return introduced ? (
    <RhythmGame preview={preview} playable={playable} />
  ) : (
    <RhythmIntro onComplete={() => setIntroduced(true)} />
  );
}

function RhythmIntro({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  // Reuse the sonic-logo controls without starting another game's soundtrack.
  const music = useWeplayMusic(false);
  const finish = () => {
    const entry = root.current?.closest<HTMLElement>(".rhythm-entry");
    const restoreFocus = root.current?.contains(document.activeElement);
    onComplete();
    // Also support a standalone entry, without adding a nested main landmark.
    if (restoreFocus)
      requestAnimationFrame(() => {
        if (entry?.isConnected)
          (entry.querySelector<HTMLElement>("h1[tabindex]") || entry).focus({
            preventScroll: true,
          });
      });
  };
  return (
    <div ref={root} className="rhythm-opening">
      <WeplayMusicButton {...music} />
      <WeplayStudioIntro onComplete={finish} />
    </div>
  );
}
