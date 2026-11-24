import { COUNT_IN_SECONDS } from "./rhythmCore";

export interface MelodyEvent {
  beat: number;
  length: number;
  midi: number;
}
export interface RhythmSong {
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
  beatsPerBar: number;
  totalBeats: number;
  /** Total seconds, including count-in and release tail. */
  duration: number;
  melody: readonly MelodyEvent[];
  bassRoots: readonly number[];
  style: "arirang" | "rock" | "festival" | "anthem";
  credit: string;
}

type Tone = readonly [midi: number, beats: number];
type Bar = readonly Tone[];
const REST = 0;

function makeSong(
  meta: Omit<RhythmSong, "duration" | "melody" | "totalBeats">,
  bars: readonly Bar[],
  repeats = 2,
): RhythmSong {
  const melody: MelodyEvent[] = [];
  let beat = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const bar of bars) {
      for (const [midi, length] of bar) {
        if (midi !== REST) melody.push({ midi, length, beat });
        beat += length;
      }
    }
  }
  const totalBeats = Math.round(beat * 1000) / 1000;
  return {
    ...meta,
    melody,
    totalBeats,
    duration: COUNT_IN_SECONDS + (totalBeats * 60) / meta.bpm + 1.2,
  };
}

/**
 * Traditional Bonjo Arirang only. Melody checked against the National Gugak
 * Center's 교과서표준악보집, printed p.344 (단소 13. 아리랑):
 * https://www.gugak.go.kr/userfiles/files/textbook_final.pdf
 * The traditional pitches 仲/林/無/潢/汰/㳞 are transposed to G/A/C/D/E/G.
 * Three subdivisions per beat preserve its 세마치 lilt; ornaments are simplified.
 * The underlying Arirang is described as expired copyright by the Korea
 * Copyright Commission (wrtSn=13289671). No modern recording/arrangement copied.
 */
const ARIRANG_BARS: readonly Bar[] = [
  [
    [67, 5 / 3],
    [69, 1 / 3],
    [67, 2 / 3],
    [69, 1 / 3],
  ],
  [
    [72, 5 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [74, 1 / 3],
  ],
  [
    [76, 1],
    [74, 1 / 3],
    [76, 1 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [69, 1 / 3],
  ],
  [
    [67, 5 / 3],
    [69, 1 / 3],
    [67, 1 / 3],
    [69, 1 / 3],
    [REST, 1 / 3],
  ],
  [
    [72, 5 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [74, 1 / 3],
  ],
  [
    [76, 2 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [69, 1 / 3],
    [67, 2 / 3],
    [69, 1 / 3],
  ],
  [
    [72, 5 / 3],
    [74, 1 / 3],
    [72, 1],
  ],
  [
    [72, 2],
    [REST, 1],
  ],
  [
    [79, 2],
    [79, 1],
  ],
  [
    [79, 1],
    [76, 1],
    [74, 1],
  ],
  [
    [76, 1],
    [74, 1 / 3],
    [76, 1 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [69, 1 / 3],
  ],
  [
    [67, 5 / 3],
    [69, 1 / 3],
    [67, 1 / 3],
    [69, 1 / 3],
    [REST, 1 / 3],
  ],
  [
    [72, 5 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [74, 1 / 3],
  ],
  [
    [76, 2 / 3],
    [74, 1 / 3],
    [72, 2 / 3],
    [69, 1 / 3],
    [67, 2 / 3],
    [69, 1 / 3],
  ],
  [
    [72, 5 / 3],
    [74, 1 / 3],
    [72, 1],
  ],
  [
    [72, 2],
    [REST, 1],
  ],
];

/** Independently composed for Westory. These are not altered versions of the
 * requested copyrighted works 얼씨구야 / 풍년 / 아름다운 나라. Only broad styles
 * (folk rock, harvest festival, spacious anthem) inform these new melodies. */
const RUN_BARS: readonly Bar[] = [
  [
    [74, 0.5],
    [69, 0.5],
    [74, 1],
    [76, 0.5],
    [81, 0.5],
    [78, 1],
  ],
  [
    [76, 1],
    [69, 0.5],
    [71, 0.5],
    [74, 1],
    [REST, 1],
  ],
  [
    [78, 0.5],
    [81, 0.5],
    [83, 1],
    [81, 0.5],
    [78, 0.5],
    [76, 1],
  ],
  [
    [74, 1.5],
    [71, 0.5],
    [69, 1],
    [REST, 1],
  ],
  [
    [71, 0.5],
    [74, 1],
    [78, 0.5],
    [76, 0.5],
    [74, 0.5],
    [69, 1],
  ],
  [
    [71, 1],
    [76, 1],
    [78, 0.5],
    [81, 0.5],
    [83, 1],
  ],
  [
    [81, 0.5],
    [76, 0.5],
    [78, 1],
    [74, 0.5],
    [71, 0.5],
    [76, 1],
  ],
  [
    [74, 3],
    [REST, 1],
  ],
  [
    [86, 1],
    [81, 0.5],
    [83, 0.5],
    [78, 1],
    [76, 1],
  ],
  [
    [81, 0.5],
    [78, 0.5],
    [74, 1],
    [71, 1],
    [69, 1],
  ],
  [
    [74, 0.5],
    [78, 0.5],
    [76, 1],
    [81, 0.5],
    [83, 0.5],
    [81, 1],
  ],
  [
    [74, 3],
    [REST, 1],
  ],
];
const HARVEST_BARS: readonly Bar[] = [
  [
    [69, 0.5],
    [72, 0.5],
    [76, 0.5],
    [74, 1],
    [72, 0.5],
  ],
  [
    [67, 1.5],
    [69, 0.5],
    [72, 1],
  ],
  [
    [74, 0.5],
    [79, 1],
    [76, 0.5],
    [74, 0.5],
    [72, 0.5],
  ],
  [
    [69, 2.5],
    [REST, 0.5],
  ],
  [
    [76, 0.5],
    [72, 0.5],
    [69, 0.5],
    [67, 1],
    [64, 0.5],
  ],
  [
    [67, 1],
    [72, 0.5],
    [74, 1],
    [76, 0.5],
  ],
  [
    [79, 0.5],
    [76, 0.5],
    [72, 0.5],
    [74, 1],
    [69, 0.5],
  ],
  [
    [72, 2],
    [REST, 1],
  ],
  [
    [81, 1],
    [79, 0.5],
    [76, 0.5],
    [72, 1],
  ],
  [
    [74, 0.5],
    [69, 1],
    [67, 0.5],
    [72, 1],
  ],
  [
    [76, 1.5],
    [79, 0.5],
    [81, 1],
  ],
  [
    [79, 0.5],
    [74, 0.5],
    [72, 1.5],
    [REST, 0.5],
  ],
  [
    [69, 0.5],
    [74, 0.5],
    [76, 1],
    [72, 1],
  ],
  [
    [67, 0.5],
    [69, 0.5],
    [72, 0.5],
    [76, 1],
    [74, 0.5],
  ],
  [
    [72, 1],
    [69, 0.5],
    [67, 0.5],
    [64, 1],
  ],
  [
    [69, 2.5],
    [REST, 0.5],
  ],
];
const LANDSCAPE_BARS: readonly Bar[] = [
  [
    [62, 1],
    [69, 1.5],
    [66, 0.5],
    [64, 1],
  ],
  [
    [71, 2],
    [69, 1],
    [66, 1],
  ],
  [
    [74, 1.5],
    [73, 0.5],
    [69, 1],
    [71, 1],
  ],
  [
    [66, 3],
    [REST, 1],
  ],
  [
    [64, 1],
    [66, 1],
    [71, 1.5],
    [69, 0.5],
  ],
  [
    [73, 2],
    [76, 1],
    [74, 1],
  ],
  [
    [71, 1],
    [66, 0.5],
    [69, 0.5],
    [64, 1],
    [62, 1],
  ],
  [
    [69, 3],
    [REST, 1],
  ],
  [
    [74, 1],
    [81, 1],
    [78, 1.5],
    [76, 0.5],
  ],
  [
    [73, 2],
    [74, 1],
    [69, 1],
  ],
  [
    [71, 1],
    [76, 1.5],
    [78, 0.5],
    [74, 1],
  ],
  [
    [69, 3],
    [REST, 1],
  ],
  [
    [66, 1.5],
    [71, 0.5],
    [69, 1],
    [64, 1],
  ],
  [
    [62, 1],
    [66, 1],
    [69, 1],
    [73, 1],
  ],
  [
    [74, 2],
    [69, 1],
    [66, 1],
  ],
  [
    [62, 3],
    [REST, 1],
  ],
];

export const RHYTHM_SONGS: readonly RhythmSong[] = [
  makeSong(
    {
      id: "arirang",
      title: "아리랑",
      subtitle: "전통 선율 · 세마치 록",
      bpm: 126,
      beatsPerBar: 3,
      style: "arirang",
      bassRoots: [
        48, 48, 53, 55, 48, 55, 48, 48, 53, 53, 55, 55, 48, 55, 48, 48,
      ],
      credit: "전통 민요 아리랑 · 위스토리 자체 합성 편곡",
    },
    ARIRANG_BARS,
  ),
  makeSong(
    {
      id: "eolssu-run",
      title: "얼쑤, 달려라",
      subtitle: "창작곡 · 경쾌한 국악 록",
      bpm: 132,
      beatsPerBar: 4,
      style: "rock",
      bassRoots: [50, 50, 47, 45, 43, 45, 47, 50, 43, 47, 45, 50],
      credit: "위스토리 자체 창작곡 · 외부 음원 미사용",
    },
    RUN_BARS,
  ),
  makeSong(
    {
      id: "harvest-yard",
      title: "풍년 마당",
      subtitle: "창작곡 · 여섯 박의 잔치",
      bpm: 120,
      beatsPerBar: 3,
      style: "festival",
      bassRoots: [
        45, 48, 43, 45, 41, 43, 48, 45, 41, 43, 45, 48, 41, 43, 45, 45,
      ],
      credit: "위스토리 자체 창작곡 · 외부 음원 미사용",
    },
    HARVEST_BARS,
  ),
  makeSong(
    {
      id: "our-landscape",
      title: "우리의 강산",
      subtitle: "창작곡 · 웅장한 행진",
      bpm: 84,
      beatsPerBar: 4,
      style: "anthem",
      bassRoots: [
        38, 43, 47, 45, 40, 45, 43, 45, 38, 47, 43, 45, 43, 45, 38, 38,
      ],
      credit: "위스토리 자체 창작곡 · 외부 음원 미사용",
    },
    LANDSCAPE_BARS,
    1,
  ),
];
