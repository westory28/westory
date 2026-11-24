import { COUNT_IN_SECONDS, type DrumKind } from "./rhythmCore";
import type { RhythmSong } from "./rhythmSongs";

const clampVolume = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7;
const midiFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const DRUM_SECONDS = { center: 0.32, rim: 0.1 };
const RIM_STRIKE_OFFSET = 0.5;

/**
 * Original oscillator/noise synthesis. No samples, third-party recordings,
 * microphone access or persistent data. A caller can supply server authorization
 * before any sound is scheduled. All events share the
 * AudioContext clock, so rendering speed cannot move music away from the chart.
 */
export class RhythmAudio {
  onStateChange?: () => void;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private noise: AudioBuffer | null = null;
  private strikeBuffer: AudioBuffer | null = null;
  private pluckWave: PeriodicWave | null = null;
  private fluteWave: PeriodicWave | null = null;
  private bassWave: PeriodicWave | null = null;
  private origin = 0;
  private generation = 0;
  private disposed = false;
  private volume = 0.7;

  /** Audio seconds since start, including the three-second count-in. */
  get currentTime(): number {
    return this.context && this.master
      ? Math.max(0, this.context.currentTime - this.origin)
      : 0;
  }

  get state(): string {
    return this.context?.state ?? (this.disposed ? "closed" : "idle");
  }

  async start(
    song: RhythmSong,
    volume = 0.7,
    authorize?: () => Promise<boolean>,
  ): Promise<void> {
    if (this.disposed)
      throw new Error("종료된 연주입니다. 곡을 다시 선택해 주세요.");
    this.stop();
    this.volume = clampVolume(volume);
    const generation = this.generation;
    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor)
      throw new Error("이 브라우저는 소리 재생을 지원하지 않습니다.");

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    context.onstatechange = () => {
      if (this.context === context) this.onStateChange?.();
    };
    // Called before the first await so browsers retain the user's start gesture.
    const resumed = context.resume();
    try {
      await this.withDeadline(resumed);
      if (this.generation !== generation || this.context !== context) return;
      if (context.state !== "running")
        throw new Error(
          "소리를 켜지 못했습니다. 시작 버튼을 다시 눌러 주세요.",
        );
      if (authorize) {
        const allowed = await this.withDeadline(
          authorize(),
          10000,
          "공개 상태를 확인하지 못했습니다. 다시 시도해 주세요.",
        );
        if (this.generation !== generation || this.context !== context) return;
        if (allowed !== true)
          throw new Error("지금은 이용할 수 없는 게임입니다.");
        if (context.state !== "running")
          throw new Error(
            "소리 재생이 중단되었습니다. 시작 버튼을 다시 눌러 주세요.",
          );
      }
      this.master = context.createGain();
      this.master.gain.value = this.volume * 0.68;
      this.compressor = context.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.master.connect(this.compressor);
      this.compressor.connect(context.destination);
      this.pluckWave = this.wave([0, 1, 0.35, 0.17, 0.08, 0.04]);
      this.fluteWave = this.wave([0, 1, 0.13, 0.08, 0.025]);
      this.bassWave = this.wave([0, 1, 0.2, 0.07]);
      this.noise = this.makeNoise(context);
      void this.prepareStrikeBuffer(context);
      // A small scheduling lead keeps even the first cue out of the past.
      this.origin = context.currentTime + 0.08;
      this.scheduleSong(song);
      this.onStateChange?.();
    } catch (error) {
      if (this.context === context) this.stop();
      throw error;
    }
  }

  async pause(): Promise<void> {
    const context = this.context;
    if (context?.state === "running") await context.suspend();
  }

  /** Resume only from an explicit user action; never auto-resume a hidden tab. */
  async resume(): Promise<void> {
    const context = this.context;
    if (!context || context.state === "closed")
      throw new Error("연주가 종료되었습니다. 다시 시작해 주세요.");
    const generation = this.generation;
    try {
      const resumed = context.resume().then(() => {
        // A timed-out resume can settle after stop/dispose or a new song starts.
        if (
          this.disposed ||
          this.context !== context ||
          this.generation !== generation
        ) {
          context.onstatechange = null;
          if (context.state !== "closed") void context.close().catch(() => {});
        }
      });
      await this.withDeadline(resumed);
      if (
        this.disposed ||
        this.context !== context ||
        this.generation !== generation
      )
        return;
      if (context.state !== "running")
        throw new Error(
          "소리를 다시 켜지 못했습니다. 계속하기를 다시 눌러 주세요.",
        );
    } catch (error) {
      if (this.context === context) this.stop();
      throw error;
    }
  }

  setVolume(volume: number): void {
    // Authorization/resume may still be pending and the graph may not exist.
    // Apply the latest choice when it is connected, not the stale start value.
    this.volume = clampVolume(volume);
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.volume * 0.68,
        this.context.currentTime,
        0.015,
      );
  }

  hit(kind: DrumKind): void {
    if (this.context?.state !== "running" || !this.master || !this.noise)
      return;
    const at = this.context.currentTime + 0.002;
    if (!this.strikeBuffer) {
      this.drum(kind, at, 0.65);
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.strikeBuffer;
    source.connect(this.master);
    source.start(at, kind === "center" ? 0 : RIM_STRIKE_OFFSET);
    this.register(source, at + DRUM_SECONDS[kind] + 0.01, []);
  }

  private async prepareStrikeBuffer(context: AudioContext): Promise<void> {
    // Render the two original voices once at this device's sample rate.
    // The count-in and live synthesis can already play while this is pending.
    const Offline = window.OfflineAudioContext;
    if (!Offline) return;
    try {
      const offline = new Offline(
        1,
        Math.ceil(
          (RIM_STRIKE_OFFSET + DRUM_SECONDS.rim + 0.01) * context.sampleRate,
        ),
        context.sampleRate,
      );
      this.drum("center", 0, 0.65, offline);
      this.drum("rim", RIM_STRIKE_OFFSET, 0.65, offline);
      const buffer = await offline.startRendering();
      if (this.context === context) this.strikeBuffer = buffer;
    } catch {
      // A device that cannot render offline keeps using the same live voices.
    }
  }

  stop(): void {
    this.generation += 1;
    const context = this.context;
    this.context = null;
    if (context) context.onstatechange = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already-ended sources can remain here until their ended event arrives.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.master?.disconnect();
    this.compressor?.disconnect();
    this.master = null;
    this.compressor = null;
    this.noise = null;
    this.strikeBuffer = null;
    this.pluckWave = null;
    this.fluteWave = null;
    this.bassWave = null;
    this.origin = 0;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
    this.onStateChange?.();
  }

  dispose(): void {
    this.onStateChange = undefined;
    this.disposed = true;
    this.stop();
  }

  private async withDeadline<T>(
    operation: Promise<T>,
    milliseconds = 4000,
    message = "소리 재생이 지연됩니다. 버튼을 다시 눌러 주세요.",
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), milliseconds);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private wave(harmonics: number[]): PeriodicWave {
    return this.context!.createPeriodicWave(
      new Float32Array(harmonics.length),
      new Float32Array(harmonics),
    );
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let seed = 0x7259;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      samples[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  private register(
    source: AudioScheduledSourceNode,
    end: number,
    chain: AudioNode[],
  ): void {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      for (const node of chain) node.disconnect();
    };
    source.stop(end);
  }

  private tone(
    midi: number,
    at: number,
    duration: number,
    level: number,
    voice: "pluck" | "flute" | "bass",
  ): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.setPeriodicWave(
      (voice === "pluck"
        ? this.pluckWave
        : voice === "bass"
          ? this.bassWave
          : this.fluteWave)!,
    );
    oscillator.frequency.setValueAtTime(midiFrequency(midi), at);
    const attack = voice === "flute" ? 0.025 : 0.006;
    const release = voice === "bass" ? 0.07 : 0.12;
    const hold = Math.max(attack + 0.01, duration);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + attack);
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, level * (voice === "pluck" ? 0.2 : 0.65)),
      at + hold,
    );
    envelope.gain.linearRampToValueAtTime(0, at + hold + release);
    oscillator.connect(envelope);
    envelope.connect(this.master!);
    oscillator.start(at);
    this.register(oscillator, at + hold + release + 0.01, [envelope]);
  }

  private drum(
    kind: DrumKind,
    at: number,
    level: number,
    offline?: OfflineAudioContext,
  ): void {
    const context = offline ?? this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const center = kind === "center";
    const duration = DRUM_SECONDS[kind];
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(center ? 150 : 510, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      center ? 57 : 235,
      at + duration,
    );
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(
      level * (center ? 0.42 : 0.2),
      at + 0.002,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    envelope.gain.setValueAtTime(0, at + duration + 0.005);
    oscillator.connect(envelope);
    envelope.connect(offline?.destination ?? this.master!);
    oscillator.start(at);
    const end = at + duration + 0.01;
    if (offline) oscillator.stop(end);
    else this.register(oscillator, end, [envelope]);
    this.noiseHit(
      at,
      center ? 0.045 : 0.07,
      level * (center ? 0.035 : 0.105),
      center ? 1000 : 2300,
      offline,
    );
  }

  private noiseHit(
    at: number,
    duration: number,
    level: number,
    frequency: number,
    offline?: OfflineAudioContext,
  ): void {
    const context = offline ?? this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    envelope.gain.setValueAtTime(0, at + duration + 0.003);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(offline?.destination ?? this.master!);
    source.start(at);
    const end = at + duration + 0.005;
    if (offline) source.stop(end);
    else this.register(source, end, [filter, envelope]);
  }

  private scheduleSong(song: RhythmSong): void {
    const beatSeconds = 60 / song.bpm;
    const start = this.origin + COUNT_IN_SECONDS;
    for (let count = 0; count < COUNT_IN_SECONDS; count++)
      this.tone(
        count === 2 ? 84 : 79,
        this.origin + count,
        0.065,
        0.12,
        "pluck",
      );
    for (const event of song.melody) {
      const voice = song.style === "festival" ? "pluck" : "flute";
      this.tone(
        event.midi,
        start + event.beat * beatSeconds,
        Math.max(0.055, event.length * beatSeconds * 0.88),
        0.22,
        voice,
      );
      // Quiet octave reinforcement opens up the second half without a sample.
      if (song.style === "anthem" && event.beat >= song.totalBeats / 2)
        this.tone(
          event.midi - 12,
          start + event.beat * beatSeconds,
          event.length * beatSeconds * 0.8,
          0.065,
          "flute",
        );
    }
    const bars = Math.ceil(song.totalBeats / song.beatsPerBar);
    for (let bar = 0; bar < bars; bar++) {
      const root = song.bassRoots[bar % song.bassRoots.length];
      const at = start + bar * song.beatsPerBar * beatSeconds;
      const barSeconds = song.beatsPerBar * beatSeconds;
      if (song.style === "anthem") {
        this.tone(root + 12, at, barSeconds * 0.9, 0.045, "flute");
        this.tone(root + 19, at, barSeconds * 0.9, 0.035, "flute");
      }
      for (let beat = 0; beat < song.beatsPerBar; beat++) {
        const time = at + beat * beatSeconds;
        const downbeat = beat === 0;
        this.tone(
          root + (beat === 2 ? 7 : 0),
          time,
          beatSeconds * 0.58,
          downbeat ? 0.15 : 0.095,
          "bass",
        );
        this.drum(
          downbeat || (song.style === "rock" && beat === 2) ? "center" : "rim",
          time,
          downbeat ? 0.52 : 0.32,
        );
        const offbeat = song.style === "arirang" ? 2 / 3 : 0.5;
        this.noiseHit(time + beatSeconds * offbeat, 0.045, 0.035, 5500);
        if (song.style === "rock" && beat % 2 === 1)
          this.tone(root + 19, time, beatSeconds * 0.4, 0.045, "pluck");
      }
      // Two compound accents per 6/8 bar give the harvest track its own gait.
      if (song.style === "festival")
        this.drum("center", at + beatSeconds * 1.5, 0.3);
    }
  }
}
