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
  if (duration < 90 || duration > 180)
    return "전체 제한시간은 90~180초로 입력해 주세요.";
  const falls = [value.first, value.middle, value.last].map(Number);
  const maximum = Math.min(30, Math.floor((duration / 3 - 1) * 0.64));
  if (falls.some((fall) => fall < 1 || fall > maximum))
    return `현재 제한시간에서 입력 시간은 1~${maximum}초로 입력해 주세요.`;
  if (!(falls[0] > falls[1] && falls[1] > falls[2]))
    return "입력 시간은 초반 > 중반 > 후반 순으로 짧아져야 합니다.";
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
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        levels.map((level) => [level, toValues(settings.difficulties[level])]),
      ) as Record<WeplayDifficulty, Values>,
  );
  const change = (level: WeplayDifficulty, field: Field, value: string) => {
    const next = { ...values, [level]: { ...values[level], [field]: value } };
    setValues(next);
    const invalid = levels.find((level) => errorFor(next[level]));
    onValidityChange(
      invalid
        ? `${WEPLAY_DIFFICULTY_LABELS[invalid]}: ${errorFor(next[invalid])}`
        : "",
    );
    if (!errorFor(next[level])) {
      const current = next[level];
      update({
        difficulties: {
          ...settings.difficulties,
          [level]: {
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
  const fields: {
    field: Field;
    label: string;
    min: number;
    max?: number;
  }[] = [
    {
      field: "durationSeconds",
      label: "전체 제한시간",
      min: 90,
      max: 180,
    },
    {
      field: "first",
      label: "초반 입력 시간",
      min: 1,
    },
    {
      field: "middle",
      label: "중반 입력 시간",
      min: 1,
    },
    {
      field: "last",
      label: "후반 입력 시간",
      min: 1,
    },
    {
      field: "minWordLength",
      label: "최소 단어 길이",
      min: 1,
      max: 12,
    },
    {
      field: "maxWordLength",
      label: "최대 단어 길이",
      min: 1,
      max: 12,
    },
  ];
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
        className="teacher-weplay-table-scroll"
        role="region"
        aria-label="난이도별 설정 표"
        tabIndex={0}
      >
        <table className="teacher-weplay-settings-table">
          <caption className="teacher-weplay-sr-only">
            난이도별 시간과 단어 길이 설정
          </caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                난이도
              </th>
              <th scope="col" rowSpan={2}>
                제한시간 <span>(초)</span>
              </th>
              <th scope="colgroup" colSpan={3}>
                입력 시간 <span>(초)</span>
              </th>
              <th scope="colgroup" colSpan={2}>
                단어 길이 <span>(자)</span>
              </th>
            </tr>
            <tr>
              <th scope="col">초반</th>
              <th scope="col">중반</th>
              <th scope="col">후반</th>
              <th scope="col">최소</th>
              <th scope="col">최대</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => {
              const invalid = errorFor(values[level]);
              const maxFall = Math.min(
                30,
                Math.floor(
                  (Number(values[level].durationSeconds) / 3 - 1) * 0.64,
                ),
              );
              return (
                <tr key={level}>
                  <th scope="row">{WEPLAY_DIFFICULTY_LABELS[level]}</th>
                  {fields.map(({ field, label, min, max }) => (
                    <td key={field}>
                      <input
                        aria-label={`${WEPLAY_DIFFICULTY_LABELS[level]} ${label}`}
                        type="number"
                        inputMode="numeric"
                        min={min}
                        max={max ?? maxFall}
                        step="1"
                        value={values[level][field]}
                        disabled={disabled}
                        onChange={(event) =>
                          change(level, field, event.target.value)
                        }
                        aria-invalid={!!invalid}
                        aria-describedby={
                          invalid
                            ? `weplay-difficulty-error-${level}`
                            : undefined
                        }
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {levels.map((level) => {
        const invalid = errorFor(values[level]);
        return invalid ? (
          <p
            key={level}
            className="teacher-weplay-error"
            role="alert"
            id={`weplay-difficulty-error-${level}`}
          >
            {WEPLAY_DIFFICULTY_LABELS[level]}: {invalid}
          </p>
        ) : null;
      })}
      <p className="teacher-weplay-note">
        시간·난이도 변경은 연습·체험에 바로, 위스 도전에는 다음 랭킹 기간부터
        적용됩니다.
      </p>
    </section>
  );
}
