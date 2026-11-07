import { useId } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  ACHIEVEMENT_LEVELS,
  HISTORY_ACHIEVEMENT_CURRICULUM_VERSION,
  HISTORY_ACHIEVEMENT_STANDARDS,
  getHistoryAchievementStandard,
  getHistoryAchievementRubric,
  HISTORY_ACHIEVEMENT_RUBRIC_SOURCE,
  type AchievementDifficulty,
  type AchievementLevel,
  type HistoryAchievementMetadata,
} from "../../../lib/historyAchievement";

interface Props {
  value: HistoryAchievementMetadata;
  onChange: (value: HistoryAchievementMetadata) => void;
  inferred: { codes: string[]; candidates: string[]; ambiguous: boolean };
}

export default function QuizAchievementFields({
  value,
  onChange,
  inferred,
}: Props) {
  const selected = value.achievementStandardCodes || [];
  const selectId = useId();
  const rubric = getHistoryAchievementRubric(selected[0] || "");
  const domains = [
    ...new Map(
      HISTORY_ACHIEVEMENT_STANDARDS.map((standard) => [
        standard.domainCode,
        standard.domainTitle,
      ]),
    ).entries(),
  ];
  const updateCodes = (codes: string[], source: "manual" | "unit") =>
    onChange({
      ...value,
      curriculumVersion: HISTORY_ACHIEVEMENT_CURRICULUM_VERSION,
      achievementStandardCodes: codes,
      achievementMappingSource: source,
      ...(!codes.length || codes.join("|") !== selected.join("|")
        ? { targetAchievementLevel: "", intendedDifficulty: "" }
        : {}),
    });
  return (
    <div className="quiz-achievement-fields">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-sm font-bold text-gray-700">
          <label htmlFor={selectId}>성취기준</label>
          <InfoHelp
            label="성취기준 연결"
            sections={[
              {
                text: "교육부 고시 제2018-162호의 중학교 역사② 성취기준입니다. 단원 이름과 연결되는 기준이 하나이면 자동 입력합니다. 여러 기준에 해당하면 직접 선택합니다.",
              },
              {
                text: "직접 선택한 기준은 단원을 변경해도 유지됩니다. 단원 기준 적용을 누르면 현재 단원의 연결로 바뀝니다. 목표 성취수준은 이 문항으로 확인할 수행 수준이며 학생의 성취도와는 구분합니다.",
              },
            ]}
          />
        </div>
        <button
          type="button"
          className="quiz-authoring-button"
          disabled={!inferred.codes.length}
          onClick={() => updateCodes(inferred.codes, "unit")}
        >
          단원 기준 적용
        </button>
      </div>
      <select
        id={selectId}
        aria-label="성취기준"
        value={selected[0] || ""}
        className="quiz-compose-field min-h-11 w-full min-w-0 rounded border p-2 text-sm"
        onChange={(event) =>
          updateCodes(event.target.value ? [event.target.value] : [], "manual")
        }
      >
        <option value="">
          {inferred.ambiguous
            ? "성취기준 선택 · 단원에 여러 기준이 포함됨"
            : "성취기준 미지정"}
        </option>
        {selected[0] && !getHistoryAchievementStandard(selected[0]) && (
          <option value={selected[0]}>{selected[0]} · 기존 기준</option>
        )}
        {domains.map(([code, title]) => (
          <optgroup key={code} label={title}>
            {HISTORY_ACHIEVEMENT_STANDARDS.filter(
              (standard) => standard.domainCode === code,
            ).map((standard) => (
              <option key={standard.code} value={standard.code}>
                {inferred.candidates.includes(standard.code)
                  ? "단원 연결 · "
                  : ""}
                [{standard.code}] {standard.description}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {selected.slice(1).map((code) => (
            <button
              key={code}
              type="button"
              className="quiz-authoring-button"
              aria-label={`${code} 연결 제거`}
              onClick={() =>
                updateCodes(
                  selected.filter((item) => item !== code),
                  "manual",
                )
              }
            >
              {code} ×
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="quiz-composer-field">
          <div className="flex items-center gap-1 text-sm font-bold text-gray-700">
            <label htmlFor={`${selectId}-level`}>목표 성취수준</label>
            {rubric && (
              <InfoHelp
                label="성취수준 준거"
                sections={[
                  {
                    text: `${HISTORY_ACHIEVEMENT_RUBRIC_SOURCE} ${rubric.sourcePages.join(", ")}쪽을 중학교 역사②에 맞춰 재구성한 준거입니다.`,
                  },
                  ...ACHIEVEMENT_LEVELS.map((level) => ({
                    title: level,
                    text: rubric.levels[level],
                  })),
                  { text: rubric.mappingNote },
                ]}
              />
            )}
          </div>
          <select
            id={`${selectId}-level`}
            aria-label="목표 성취수준"
            disabled={!selected.length}
            value={value.targetAchievementLevel || ""}
            className="quiz-compose-field min-h-11 rounded border p-2 text-sm"
            onChange={(event) =>
              onChange({
                ...value,
                targetAchievementLevel: event.target.value as
                  | AchievementLevel
                  | "",
              })
            }
          >
            <option value="">미지정</option>
            {ACHIEVEMENT_LEVELS.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </div>
        <label className="quiz-composer-field">
          <span>예상 난이도</span>
          <select
            aria-label="예상 난이도"
            disabled={!selected.length}
            value={value.intendedDifficulty || ""}
            className="quiz-compose-field min-h-11 rounded border p-2 text-sm"
            onChange={(event) =>
              onChange({
                ...value,
                intendedDifficulty: event.target.value as
                  | AchievementDifficulty
                  | "",
              })
            }
          >
            <option value="">미지정</option>
            <option value="hard">어려움</option>
            <option value="medium">보통</option>
            <option value="easy">쉬움</option>
          </select>
        </label>
      </div>
    </div>
  );
}
