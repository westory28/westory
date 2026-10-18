import useWeplayMusic from "./useWeplayMusic";

/** Call start only from a user gesture; a blocked player offers toggle to retry. */
export default function useYutMusic(active = true) {
  return useWeplayMusic(
    active,
    `${import.meta.env.BASE_URL}assets/weplay/yut/moonlit-courtyard.wav`,
  );
}
