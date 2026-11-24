import { useEffect, useRef, useState } from "react";
import type {
  StockBulletin,
  StockBulletinItem,
} from "./wisStockDisplayBulletins";
import { stockBulletinExpiresAt } from "./wisStockDisplayBulletins";

export function stockBulletinSpeech(items: StockBulletinItem[]) {
  return items
    .map((item) => {
      if (item.kind === "listing") return `${item.name}, 신규 상장.`;
      return `${item.name}, ${item.percent > 0 ? "급등" : "급락"}.`;
    })
    .join(" ");
}

export function selectKoreanBulletinVoice(voices: SpeechSynthesisVoice[]) {
  const quality = (voice: SpeechSynthesisVoice) =>
    (voice.localService ? 100 : 0) +
    (voice.default ? 20 : 0) +
    (/natural|neural|enhanced|premium/i.test(voice.name)
      ? 8
      : /google/i.test(voice.name)
        ? 6
        : 0);
  return voices
    .filter((voice) => /^ko(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => quality(b) - quality(a))[0];
}

function speechFailureMessage(error: string) {
  if (error === "not-allowed")
    return "음성을 켜서 브라우저의 음성 재생을 시작해 주세요.";
  if (error === "language-unavailable" || error === "voice-unavailable")
    return "한국어 음성이 준비되지 않았습니다. 기기 설정에서 한국어 음성 데이터를 설치한 뒤 다시 켜 주세요.";
  if (error === "network")
    return "음성 연결이 끊겼습니다. 인터넷 연결을 확인한 뒤 음성을 다시 켜 주세요.";
  if (error === "audio-busy" || error === "audio-hardware")
    return "기기의 소리 출력을 사용할 수 없습니다. 다른 앱의 재생과 소리 출력을 확인한 뒤 다시 켜 주세요.";
  return "기기의 음성 엔진이 응답하지 않습니다. 기기 설정에서 텍스트 읽어주기의 한국어 미리듣기를 확인한 뒤 다시 켜 주세요.";
}

export function useWisStockBulletinAudio(
  bulletin: StockBulletin | null,
  enabled: boolean,
) {
  const [sound, setSound] = useState(true);
  const [speech, setSpeech] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [voicesReady, setVoicesReady] = useState(false);
  const [message, setMessage] = useState("");
  const context = useRef<AudioContext | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout>>();
  const speechDeadline = useRef<ReturnType<typeof setTimeout>>();
  const speechRetry = useRef<ReturnType<typeof setTimeout>>();
  const speechStart = useRef<ReturnType<typeof setTimeout>>();
  const speechGeneration = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const playback = useRef({ enabled, speech });
  playback.current = { enabled, speech };
  const oscillators = useRef<OscillatorNode[]>([]);
  const played = useRef({ sound: "", speech: "" });
  const speechAvailable =
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";
  const soundAvailable = typeof window.AudioContext !== "undefined";

  const stopSound = () => {
    for (const node of oscillators.current) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    }
    oscillators.current = [];
  };
  const stopSpeech = () => {
    speechGeneration.current++;
    clearTimeout(speechTimer.current);
    clearTimeout(speechDeadline.current);
    clearTimeout(speechRetry.current);
    clearTimeout(speechStart.current);
    const owned = utteranceRef.current;
    utteranceRef.current = null;
    if (speechAvailable && owned) window.speechSynthesis.cancel();
  };
  const stop = () => {
    stopSound();
    stopSpeech();
  };

  const speak = (text: string, expiresAt: number, delay = 0) => {
    stopSpeech();
    if (!speechAvailable || !playback.current.enabled || document.hidden)
      return;
    const generation = speechGeneration.current;
    const synthesis = window.speechSynthesis;
    const available = synthesis.getVoices();
    const preferred = selectKoreanBulletinVoice(available);
    // Some device engines enumerate a local Korean voice but finish immediately
    // without producing speech. Try a different browser-provided engine before
    // falling back to automatic voice selection on the same device.
    const alternate =
      selectKoreanBulletinVoice(
        available.filter((voice) => voice !== preferred && !voice.localService),
      ) ??
      selectKoreanBulletinVoice(
        available.filter((voice) => voice !== preferred),
      );
    // Do not force an unavailable named engine forever. The final attempt lets
    // the device select its Korean engine; never substitute an English voice.
    const candidates: Array<SpeechSynthesisVoice | null> = [
      ...(preferred ? [preferred] : []),
      ...(alternate ? [alternate] : []),
      null,
    ];
    const deadline = Math.min(Date.now() + 8_000, expiresAt);
    let started = false;
    const valid = () =>
      generation === speechGeneration.current &&
      playback.current.enabled &&
      playback.current.speech &&
      !document.hidden &&
      Date.now() < deadline;
    const fail = (error: string) => {
      if (generation !== speechGeneration.current) return;
      stopSpeech();
      playback.current.speech = false;
      setSpeech(false);
      setMessage(speechFailureMessage(error));
    };
    const attempt = (index: number) => {
      if (!valid()) return;
      started = false;
      const requestedAt = Date.now();
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.lang = "ko-KR";
      utterance.voice = candidates[index];
      utterance.rate = 1.05;
      utterance.pitch = 1;
      utterance.volume = 0.85;
      const current = () => valid() && utteranceRef.current === utterance;
      const retry = (error: string) => {
        if (!current()) return;
        clearTimeout(speechStart.current);
        if (
          index + 1 < candidates.length &&
          [
            "network",
            "synthesis-failed",
            "synthesis-unavailable",
            "language-unavailable",
            "voice-unavailable",
            "invalid-argument",
            "timeout",
          ].includes(error)
        ) {
          // Ignore late failure/end events from the failed utterance before
          // releasing the engine. A short gap allows Android TTS to finish stop.
          utteranceRef.current = null;
          synthesis.cancel();
          speechRetry.current = setTimeout(() => attempt(index + 1), 150);
        } else fail(error);
      };
      utterance.onstart = () => {
        if (current()) {
          started = true;
          clearTimeout(speechStart.current);
        }
      };
      utterance.onend = () => {
        if (!current()) return;
        if (!started && Date.now() - requestedAt < 200) {
          retry("synthesis-failed");
          return;
        }
        clearTimeout(speechStart.current);
        clearTimeout(speechDeadline.current);
        utteranceRef.current = null;
      };
      utterance.onerror = (event) => {
        if (!["canceled", "interrupted"].includes(event.error))
          retry(event.error);
      };
      // With no alternative voice, allow the device's default engine its full
      // initialization window rather than failing just because voices loaded late.
      if (index + 1 < candidates.length)
        speechStart.current = setTimeout(() => retry("timeout"), 3_000);
      try {
        // Android's native Resume is a no-op. Speak a fresh utterance and only
        // resume when another browser actually reports the queue as paused.
        if (synthesis.paused) synthesis.resume();
        synthesis.speak(utterance);
      } catch {
        retry("synthesis-failed");
      }
    };
    speechDeadline.current = setTimeout(
      () => {
        // The event's original expiry is a normal cancellation; a live event with
        // an unresponsive engine is a recoverable device error, never silent success.
        if (!started && Date.now() < expiresAt) fail("timeout");
        else stopSpeech();
      },
      Math.max(0, deadline - Date.now()),
    );
    if (delay) speechTimer.current = setTimeout(() => attempt(0), delay);
    else attempt(0);
  };

  useEffect(() => {
    let active = true;
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    const updateVoices = () => {
      if (speechAvailable && window.speechSynthesis.getVoices().length > 0)
        setVoicesReady(true);
    };
    if (speechAvailable) {
      updateVoices();
      window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    }
    // Some engines only expose their default voice. Do not wait indefinitely.
    const voiceTimer = setTimeout(() => setVoicesReady(true), 750);
    if (soundAvailable) {
      try {
        // The display is mounted by its Open button. Resume immediately while
        // that user activation is still available instead of waiting for a tick.
        const audio = new AudioContext();
        context.current = audio;
        audio.onstatechange = () => {
          if (active) setSoundReady(audio.state === "running");
        };
        setSoundReady(audio.state === "running");
        void audio
          .resume()
          .then(() => {
            if (active) setSoundReady(audio.state === "running");
          })
          .catch(() => {
            if (active) {
              setSound(false);
              setMessage("알림음을 켜서 브라우저의 소리 재생을 시작해 주세요.");
            }
          });
        blockedTimer = setTimeout(() => {
          if (active && audio.state !== "running") {
            setSound(false);
            setMessage("알림음을 켜서 브라우저의 소리 재생을 시작해 주세요.");
          }
        }, 750);
      } catch {
        setSound(false);
        setMessage(
          "알림음을 재생하지 못했습니다. 브라우저의 소리 설정을 확인해 주세요.",
        );
      }
    }
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active = false;
      clearTimeout(voiceTimer);
      clearTimeout(blockedTimer);
      if (speechAvailable)
        window.speechSynthesis.removeEventListener(
          "voiceschanged",
          updateVoices,
        );
      document.removeEventListener("visibilitychange", hidden);
      stop();
      if (context.current) context.current.onstatechange = null;
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sound) stopSound();
    if (!speech) stopSpeech();
    if (!enabled || document.hidden) {
      stop();
      return;
    }
    if (!bulletin) {
      // The visual page lasts three seconds. Let the last spoken headline finish
      // after that automatic hide; explicit dismissal calls stop() immediately.
      stopSound();
      return;
    }
    // Rotation counters restart on reconnect; include the actual event identity
    // so a new price event is never muted by an earlier session's counter.
    const eventKey = `${bulletin.id}:${bulletin.stocks.map((item) => `${item.kind}:${item.id}:${item.atMs}:${item.kind === "listing" ? item.price : item.percent}`).join("|")}`;
    if (
      sound &&
      context.current?.state === "running" &&
      played.current.sound !== eventKey
    ) {
      stopSound();
      played.current.sound = eventKey;
      const audio = context.current;
      // A quiet, rounded two-note chime; no media download or API.
      for (const [offset, frequency] of [
        [0, 392],
        [0.2, 523.25],
      ]) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + offset;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.045, start + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.65);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.7);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillators.current.push(oscillator);
      }
    }
    if (
      speech &&
      speechAvailable &&
      voicesReady &&
      played.current.speech !== eventKey
    ) {
      played.current.speech = eventKey;
      speak(
        stockBulletinSpeech(bulletin.stocks),
        Math.min(
          ...bulletin.stocks.map((item) => stockBulletinExpiresAt(item.atMs)),
        ),
        sound && soundReady ? 500 : 0,
      );
    }
  }, [bulletin, enabled, sound, speech, soundReady, voicesReady]);

  const toggleSound = async () => {
    setMessage("");
    if (sound) {
      stopSound();
      setSound(false);
      return;
    }
    try {
      const audio = (context.current ??= new AudioContext());
      await audio.resume();
      if (context.current !== audio) return;
      if (audio.state !== "running") throw new Error("Audio suspended");
      played.current.sound = "";
      setSoundReady(true);
      setSound(true);
    } catch {
      setSound(false);
      setMessage(
        "알림음을 재생하지 못했습니다. 브라우저의 소리 설정을 확인해 주세요.",
      );
    }
  };
  const toggleSpeech = () => {
    setMessage("");
    if (speech) {
      playback.current.speech = false;
      stopSpeech();
      setSpeech(false);
      return;
    }
    if (!speechAvailable || !enabled || document.hidden) return;
    playback.current.speech = true;
    setSpeech(true);
    // The actual speak call stays inside the tap/click. When no bulletin is
    // visible, this confirmation also initializes and checks the device engine.
    if (bulletin) {
      played.current.speech = `${bulletin.id}:${bulletin.stocks.map((item) => `${item.kind}:${item.id}:${item.atMs}:${item.kind === "listing" ? item.price : item.percent}`).join("|")}`;
      speak(
        stockBulletinSpeech(bulletin.stocks),
        Math.min(
          ...bulletin.stocks.map((item) => stockBulletinExpiresAt(item.atMs)),
        ),
      );
    } else speak("음성 안내를 켰습니다.", Infinity);
  };
  return {
    sound,
    speech,
    soundAvailable,
    speechAvailable,
    message,
    toggleSound,
    toggleSpeech,
    stop,
  };
}
