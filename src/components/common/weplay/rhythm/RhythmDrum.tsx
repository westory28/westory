import { rhythmAsset } from "./RhythmArt";

/** Independent illustration; hit geometry lives on the unanimated parent. */
export default function RhythmDrum() {
  return (
    <img
      className="rhythm-drum-art"
      src={rhythmAsset("drum")}
      alt=""
      width={1024}
      height={1024}
      draggable={false}
    />
  );
}
