import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
} from "./weplayAudioPreference";
import {
  renderWeplayIntroSound,
  WEPLAY_INTRO_SECONDS,
} from "./weplayIntroSound";

let snapshot = { active: false, audible: false };
const listeners = new Set<() => void>();
export const getWeplayIntroAudioState = () => snapshot;
export const subscribeWeplayIntroAudio = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(active: boolean, audible: boolean) {
  if (snapshot.active === active && snapshot.audible === audible) return;
  snapshot = { active, audible };
  listeners.forEach((listener) => listener());
}

let prepared: AudioContext | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
type IntroAudioController = {
  sync: (time: number, visible: boolean) => void;
  dispose: () => void;
};
let current: IntroAudioController | null = null;
let pcm: ReturnType<typeof renderWeplayIntroSound> | undefined;
function createContext() {
  try {
    const Context =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    return Context ? new Context({ latencyHint: "interactive" }) : null;
  } catch {
    return null;
  }
}
function closeContext(context: AudioContext | null) {
  if (context && context.state !== "closed")
    void context.close().catch(() => {});
}

/** Unlock during the actual game-entry click, before React mounts the opening. */
export function prepareWeplayIntroAudio() {
  if (isWeplayAudioMuted() || current || document.hidden) return;
  prepared ||= createContext();
  if (prepared?.state === "suspended") void prepared.resume().catch(() => {});
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    closeContext(prepared);
    prepared = null;
  }, 8000);
}

/** Each mounted opening owns its sources. RAF supplies the visual timeline. */
export function createWeplayIntroAudio(): IntroAudioController {
  current?.dispose();
  clearTimeout(expiry);
  let context = prepared;
  prepared = null;
  let buffer: AudioBuffer | null = null;
  let voice: AudioBufferSourceNode | null = null;
  let output: GainNode | null = null;
  let disposed = false;
  let elapsed = 0;
  let visible = false;
  let muted = isWeplayAudioMuted();
  let reachedEnd = false;

  const stop = () => {
    if (voice && context) {
      const source = voice;
      const gain = output;
      voice = null;
      output = null;
      if (gain) {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setTargetAtTime(0, context.currentTime, 0.006);
      }
      try {
        source.stop(context.currentTime + 0.025);
      } catch {
        source.disconnect();
        gain?.disconnect();
      }
    }
    if (current === controller) publish(true, false);
  };
  const sync = (time: number, isVisible: boolean) => {
    elapsed = time;
    visible = isVisible;
    if (disposed) return;
    if (
      !visible ||
      muted ||
      document.hidden ||
      elapsed >= WEPLAY_INTRO_SECONDS * 1000
    ) {
      stop();
      return;
    }
    if (voice || reachedEnd || context?.state !== "running") return;
    try {
      if (!buffer) {
        pcm ||= renderWeplayIntroSound();
        buffer = context.createBuffer(
          2,
          pcm.channels[0].length,
          pcm.sampleRate,
        );
        pcm.channels.forEach((channel, index) =>
          buffer!.getChannelData(index).set(channel),
        );
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.6, context.currentTime + 0.018);
      source.connect(gain);
      gain.connect(context.destination);
      voice = source;
      output = gain;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (voice === source) {
          voice = null;
          output = null;
          reachedEnd = true;
          if (current === controller) publish(true, false);
        }
      };
      source.start(0, Math.max(0, elapsed / 1000));
      publish(true, true);
    } catch {
      stop();
    }
  };
  const unlock = () => {
    if (disposed || muted || document.hidden) return;
    context ||= createContext();
    if (context?.state === "suspended") {
      // No stale source is queued in this promise; RAF uses the current time.
      void context.resume().catch(() => {});
    }
  };
  const onGesture = (event: Event) => {
    // The sound button owns its click intent. Unlocking on its pointerdown can
    // turn a pending "enable" click into "mute" before pointerup arrives.
    if (
      event.target instanceof Element &&
      event.target.closest(
        "a, .weplay-music-button, .weplay-studio-intro__skip",
      )
    )
      return;
    unlock();
  };
  const unsubscribe = onWeplayAudioMutedChange((next) => {
    muted = next;
    if (!muted) unlock();
    sync(elapsed, visible);
  });
  const controller: IntroAudioController = {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      unsubscribe();
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      const retired = context;
      context = null;
      buffer = null;
      // Let the short de-click ramp finish; never retain an idle audio context.
      setTimeout(() => closeContext(retired), 35);
      if (current === controller) {
        current = null;
        publish(false, false);
      }
    },
  };
  current = controller;
  publish(true, false);
  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);
  unlock();
  return controller;
}
