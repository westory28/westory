import React, { useState } from "react";
import WeplaySettingsHelp from "./WeplaySettingsHelp";
import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayDifficulty,
  type WeplayDifficultySettings,
  type WeplayGameSettings,
} from "../../../lib/weplay";

type Field =
  | "durationSeconds"
  | "first"
  | "middle"
  | "last"
  | "minWordLength"
  | "maxWordLength";
type Values = Record<Field, string>;
const levels = Object.keys(WEPLAY_DIFFICULTY_LABELS) as WeplayDifficulty[];
const toValues = (value: WeplayDifficultySettings): Values => ({
  durationSeconds: String(value.durationSeconds),
  first: String(value.fallSeconds[0]),
  middle: String(value.fallSeconds[1]),
  last: String(value.fallSeconds[2]),
  minWordLength: String(value.minWordLength),
  maxWordLength: String(value.maxWordLength),
});
const errorFor = (value: Values) => {
  if (Object.values(value).some((item) => !/^\d+$/.test(item)))
    return "모든 설정에 정수를 입력해 주세요.";
  const duration = Number(value.durationSeconds);
  if (duration < 30 || duration > 180)
    return "전체 제한시간은 30~180초로 입력해 주세요.";
  const falls = [value.first, value.middle, value.last].map(Number);
  const maximum = Math.min(30, Math.floor((duration / 3 - 1) * 0.64));
  if (falls.some((fall) => fall < 1 || fall > maximum))
    return `현재 제한시간에서 낙하 시간은 1~${maximum}초로 입력해 주세요.`;
  if (!(falls[0] > falls[1] && falls[1] > falls[2]))
    return "낙하 시간은 초반 > 중반 > 후반 순으로 짧아져야 합니다.";
  const min = Number(value.minWordLength),
    max = Number(value.maxWordLength);
  if (min < 1 || max > 12 || min > max)
    return "단어 길이는 1~12자이며 최소 길이는 최대 길이 이하여야 합니다.";
  return "";
};
export default function WeplayDifficultyEditor({
  settings,
  disabled,
  update,
  onValidityChange,
}: {
  settings: WeplayGameSettings;
  disabled: boolean;
  update: (next: Partial<WeplayGameSettings>) => void;
  onValidityChange: (message: string) => void;
}) {
  const [active, setActive] = useState<WeplayDifficulty>("mild");
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        levels.map((level) => [level, toValues(settings.difficulties[level])]),
      ) as Record<WeplayDifficulty, Values>,
  );
  const change = (field: Field, value: string) => {
    const next = { ...values, [active]: { ...values[active], [field]: value } };
    setValues(next);
    const invalid = levels.find((level) => errorFor(next[level]));
    onValidityChange(
      invalid
        ? `${WEPLAY_DIFFICULTY_LABELS[invalid]}: ${errorFor(next[invalid])}`
        : "",
    );
    if (!errorFor(next[active])) {
      const current = next[active];
      update({
        difficulties: {
          ...settings.difficulties,
          [active]: {
            durationSeconds: Number(current.durationSeconds),
            fallSeconds: [
              Number(current.first),
              Number(current.middle),
              Number(current.last),
            ],
            minWordLength: Number(current.minWordLength),
            maxWordLength: Number(current.maxWordLength),
          },
        },
      });
    }
  };
  const maxFall = Math.min(
    30,
    Math.floor((Number(values[active].durationSeconds) / 3 - 1) * 0.64),
  );
  const fields: {
    field: Field;
    label: string;
    min: number;
    max: number;
    unit: string;
  }[] = [
    {
      field: "durationSeconds",
      label: "전체 제한시간",
      min: 30,
      max: 180,
      unit: "초",
    },
    {
      field: "first",
      label: "초반 낙하 시간",
      min: 1,
      max: maxFall,
      unit: "초",
    },
    {
      field: "middle",
      label: "중반 낙하 시간",
      min: 1,
      max: maxFall,
      unit: "초",
    },
    {
      field: "last",
      label: "후반 낙하 시간",
      min: 1,
      max: maxFall,
      unit: "초",
    },
    {
      field: "minWordLength",
      label: "최소 단어 길이",
      min: 1,
      max: 12,
      unit: "자",
    },
    {
      field: "maxWordLength",
      label: "최대 단어 길이",
      min: 1,
      max: 12,
      unit: "자",
    },
  ];
  const invalid = errorFor(values[active]);
  return (
    <section
      className="teacher-weplay-difficulty-settings"
      aria-labelledby="weplay-difficulty-settings-title"
    >
      <div className="teacher-weplay-difficulty-heading">
        <h2 id="weplay-difficulty-settings-title">난이도 설정</h2>
        <WeplaySettingsHelp />
      </div>
      <div
        className="teacher-weplay-difficulty"
        role="group"
        aria-label="설정할 난이도"
      >
        {levels.map((level) => (
          <button
            type="button"
            key={level}
            className="teacher-weplay-button"
            aria-pressed={active === level}
            onClick={() => setActive(level)}
          >
            {WEPLAY_DIFFICULTY_LABELS[level]}
          </button>
        ))}
      </div>
      <fieldset className="teacher-weplay-numeric-grid" disabled={disabled}>
        <legend className="teacher-weplay-sr-only">
          {WEPLAY_DIFFICULTY_LABELS[active]} 설정
        </legend>
        {fields.map(({ field, label, min, max, unit }) => (
          <label key={field}>
            {label}
            <span className="teacher-weplay-number">
              <input
                aria-label={`${WEPLAY_DIFFICULTY_LABELS[active]} ${label}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step="1"
                value={values[active][field]}
                onChange={(event) => change(field, event.target.value)}
                aria-invalid={!!invalid}
                aria-describedby={
                  invalid ? "weplay-difficulty-error" : undefined
                }
              />
              <span>{unit}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {invalid && (
        <p
          className="teacher-weplay-error"
          role="alert"
          id="weplay-difficulty-error"
        >
          {invalid}
        </p>
      )}
      <p className="teacher-weplay-note">
        시간·난이도 변경은 연습·체험에 바로, 위스 도전에는 다음 랭킹 기간부터
        적용됩니다.
      </p>
    </section>
  );
}
