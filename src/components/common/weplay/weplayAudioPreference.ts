export const WEPLAY_AUDIO_PREFERENCE = "westory.weplay.musicMuted";
const CHANGE_EVENT = "westory:weplay-audio-preference";
let inPageMuted = false;

export function isWeplayAudioMuted() {
  try {
    inPageMuted = localStorage.getItem(WEPLAY_AUDIO_PREFERENCE) === "true";
    return inPageMuted;
  } catch {
    return inPageMuted;
  }
}

export function setWeplayAudioMuted(muted: boolean) {
  inPageMuted = muted;
  try {
    localStorage.setItem(WEPLAY_AUDIO_PREFERENCE, String(muted));
  } catch {
    // The in-page preference still applies when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: muted }));
}

export function onWeplayAudioMutedChange(listener: (muted: boolean) => void) {
  const onChange = (event: Event) => {
    listener((event as CustomEvent<boolean>).detail);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === WEPLAY_AUDIO_PREFERENCE || event.key === null)
      listener(isWeplayAudioMuted());
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
