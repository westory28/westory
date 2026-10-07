import { useCallback, useEffect, useRef } from "react";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
} from "./weplayAudioPreference";
import { renderWeplaySound, type WeplaySoundCue } from "./weplaySoundDesign";

class WeplaySoundEngine {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private buffers = new Map<WeplaySoundCue, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private muted = isWeplayAudioMuted();
  private closed = false;
  private epoch = 0;
  private unsubscribe = onWeplayAudioMutedChange((muted) => {
    this.muted = muted;
    if (muted) this.quiet();
  });

  constructor() {
    document.addEventListener("visibilitychange", this.visibility);
  }

  private visibility = () => {
    if (document.hidden) this.quiet();
  };

  private quiet() {
    this.epoch++;
    for (const voice of this.voices) {
      voice.stop();
      voice.disconnect();
    }
    this.voices.clear();
    if (this.context?.state === "running")
      void this.context.suspend().catch(() => {});
  }

  unlock = () => {
    if (this.closed || this.muted || document.hidden) return;
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        const context = (this.context = new AudioContextClass({
          latencyHint: "interactive",
        }));
        const output = (this.output = context.createGain());
        output.gain.value = 0.5;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.knee.value = 8;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.14;
        output.connect(limiter);
        limiter.connect(context.destination);
        for (const cue of ["word", "cannon", "special"] as const) {
          const { samples, sampleRate } = renderWeplaySound(cue);
          const buffer = context.createBuffer(1, samples.length, sampleRate);
          buffer.getChannelData(0).set(samples);
          this.buffers.set(cue, buffer);
        }
      } catch {
        this.close();
        return;
      }
    }
    if (this.context.state === "suspended")
      void this.context.resume().catch(() => {});
  };

  play = (cue: WeplaySoundCue) => {
    this.unlock();
    const context = this.context;
    if (!context || this.closed || this.muted || document.hidden) return;
    const epoch = this.epoch;
    const requestedAt = performance.now();
    const start = () => {
      if (
        this.closed ||
        this.muted ||
        document.hidden ||
        this.epoch !== epoch ||
        context.state !== "running" ||
        performance.now() - requestedAt > 160
      )
        return;
      // Bound overlap even under very fast input; no sounds are queued for later.
      if (this.voices.size >= 8) {
        const oldest = this.voices.values().next().value;
        oldest?.stop();
        oldest?.disconnect();
        if (oldest) this.voices.delete(oldest);
      }
      const source = context.createBufferSource();
      source.buffer = this.buffers.get(cue) || null;
      if (!source.buffer || !this.output) return;
      source.connect(this.output);
      this.voices.add(source);
      source.onended = () => {
        this.voices.delete(source);
        source.disconnect();
      };
      source.start();
    };
    if (context.state === "running") start();
    else void context.resume().then(start, () => {});
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    this.quiet();
    this.unsubscribe();
    document.removeEventListener("visibilitychange", this.visibility);
    this.output?.disconnect();
    this.buffers.clear();
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = null;
    this.output = null;
  }
}

let sharedEngine: WeplaySoundEngine | null = null;
let consumers = 0;

/** The battle and its guide share one engine; the final unmount releases it. */
export default function useWeplaySoundEffects() {
  const engine = useRef<WeplaySoundEngine | null>(null);
  useEffect(() => {
    engine.current = sharedEngine ||= new WeplaySoundEngine();
    consumers++;
    const unlock = () => engine.current?.unlock();
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
      engine.current = null;
      consumers--;
      if (!consumers) {
        sharedEngine?.close();
        sharedEngine = null;
      }
    };
  }, []);
  const unlock = useCallback(() => engine.current?.unlock(), []);
  const play = useCallback(
    (cue: WeplaySoundCue) => engine.current?.play(cue),
    [],
  );
  return { unlock, play };
}
