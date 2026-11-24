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
    (voice.localService ? 2 : 0) +
    (/natural|neural|enhanced|premium/i.test(voice.name)
      ? 8
      : /google/i.test(voice.name)
        ? 6
        : 0) +
    (voice.default ? 1 : 0);
  return voices
    .filter((voice) => /^ko(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => quality(b) - quality(a))[0];
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
    clearTimeout(speechTimer.current);
    clearTimeout(speechDeadline.current);
    if (speechAvailable) window.speechSynthesis.cancel();
  };
  const stop = () => {
    stopSound();
    stopSpeech();
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
      // A short two-note cue synthesized locally; no media download or API.
      for (const [offset, frequency] of [
        [0, 660],
        [0.16, 880],
      ]) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + offset;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.26);
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
      stopSpeech();
      played.current.speech = eventKey;
      speechDeadline.current = setTimeout(
        stopSpeech,
        Math.max(
          0,
          Math.min(
            8_000,
            ...bulletin.stocks.map(
              (item) => stockBulletinExpiresAt(item.atMs) - Date.now(),
            ),
          ),
        ),
      );
      speechTimer.current = setTimeout(
        () => {
          if (document.hidden) return;
          const synthesis = window.speechSynthesis;
          const utterance = new SpeechSynthesisUtterance(
            stockBulletinSpeech(bulletin.stocks),
          );
          utterance.lang = "ko-KR";
          utterance.voice =
            selectKoreanBulletinVoice(synthesis.getVoices()) ?? null;
          utterance.rate = 1.15;
          utterance.pitch = 1;
          utterance.volume = 0.85;
          const deadline = speechDeadline.current;
          utterance.onend = () => clearTimeout(deadline);
          utterance.onerror = (event) => {
            if (!["canceled", "interrupted"].includes(event.error)) {
              setSpeech(false);
              setMessage(
                event.error === "not-allowed"
                  ? "음성을 켜서 브라우저의 음성 재생을 시작해 주세요."
                  : "음성을 재생하지 못했습니다. 기기의 한국어 음성을 확인한 뒤 다시 켜 주세요.",
              );
            }
          };
          synthesis.resume();
          synthesis.speak(utterance);
        },
        sound && soundReady ? 300 : 0,
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
    if (speech) stopSpeech();
    else {
      window.speechSynthesis.getVoices();
      played.current.speech = "";
    }
    setSpeech(!speech);
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
