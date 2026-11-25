import useWeplayMusic from "./useWeplayMusic";

const YUT_MUSIC = {
  source: `${import.meta.env.BASE_URL}assets/weplay/yut/moonlit-courtyard.mp3`,
  // The recording is quiet; this matches the other game's loudness.
  volume: 0.6,
  autoStart: true,
};

/** Entering the game asks for its music; a blocked player resumes on a touch. */
export default function useYutMusic(active = true) {
  return useWeplayMusic(active, YUT_MUSIC);
}
