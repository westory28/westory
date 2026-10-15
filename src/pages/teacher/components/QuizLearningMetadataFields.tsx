import React from "react";

export interface QuizLearningMetadata {
  concepts?: string[];
  cognitiveProcess?: string;
  familyId?: string;
  derivedFromQuestionId?: string;
  misconceptionTags?: Record<string, string>;
  reviewLessonId?: string;
}

export const COGNITIVE_PROCESS_OPTIONS = [
  "개념 이해",
  "사료 해석",
  "인과 관계",
  "시대 순서",
  "비교·분류",
  "근거 판단",
];

interface Props {
  value: QuizLearningMetadata;
  onChange: (value: QuizLearningMetadata) => void;
  options: string[];
  units: { id: string; title: string }[];
}

const QuizLearningMetadataFields: React.FC<Props> = ({
  value,
  onChange,
  options,
  units,
}) => (
  <fieldset className="space-y-3 border-t border-gray-200 pt-4">
    <legend className="px-1 text-sm font-bold text-gray-800">
      학습 진단 기준
    </legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold text-gray-700">
        핵심 개념{" "}
        <span className="font-normal text-gray-500">
          (쉼표로 구분, 최대 8개·각 60자)
        </span>
        <input
          type="text"
          value={(value.concepts || []).join(",")}
          onChange={(event) =>
            onChange({ ...value, concepts: event.target.value.split(",") })
          }
          placeholder="예: 왕권 강화, 중앙 집권"
          className="mt-1 min-h-11 w-full rounded border border-gray-300 p-2 font-normal"
        />
      </label>
      <label className="text-sm font-bold text-gray-700">
        사고 과정
        <select
          value={value.cognitiveProcess || ""}
          onChange={(event) =>
            onChange({ ...value, cognitiveProcess: event.target.value })
          }
          className="mt-1 min-h-11 w-full rounded border border-gray-300 p-2 font-normal"
        >
          <option value="">미지정</option>
          {value.cognitiveProcess &&
            !COGNITIVE_PROCESS_OPTIONS.includes(value.cognitiveProcess) && (
              <option>{value.cognitiveProcess}</option>
            )}
          {COGNITIVE_PROCESS_OPTIONS.map((label) => (
            <option key={label}>{label}</option>
          ))}
        </select>
      </label>
    </div>
    <label className="block text-sm font-bold text-gray-700">
      다시 볼 수업자료
      <select
        value={value.reviewLessonId || ""}
        onChange={(event) =>
          onChange({ ...value, reviewLessonId: event.target.value })
        }
        className="mt-1 min-h-11 w-full rounded border border-gray-300 p-2 font-normal"
      >
        <option value="">연결 안 함</option>
        {value.reviewLessonId &&
          !units.some((unit) => unit.id === value.reviewLessonId) && (
            <option value={value.reviewLessonId}>기존 연결 자료</option>
          )}
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.title}
          </option>
        ))}
      </select>
    </label>
    {options.filter((option) => option.trim()).length > 0 && (
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-gray-700">
          선지별 혼동 지점
        </summary>
        <div className="space-y-2">
          {options.map(
            (option, index) =>
              option.trim() && (
                <label key={index} className="block text-sm text-gray-700">
                  <span className="font-bold">
                    {index + 1}. {option}
                  </span>
                  <input
                    type="text"
                    value={value.misconceptionTags?.[option.trim()] || ""}
                    maxLength={120}
                    disabled={option.trim().length > 500}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        misconceptionTags: {
                          ...value.misconceptionTags,
                          [option.trim()]: event.target.value,
                        },
                      })
                    }
                    placeholder={
                      option.trim().length > 500
                        ? "500자가 넘는 선지에는 태그를 붙일 수 없습니다."
                        : "예: 고려와 조선의 제도 혼동 (120자 이내)"
                    }
                    className="mt-1 min-h-11 w-full rounded border border-gray-300 p-2"
                  />
                </label>
              ),
          )}
        </div>
      </details>
    )}
  </fieldset>
);

export const normalizeQuizLearningMetadata = (
  value: QuizLearningMetadata,
  options: string[],
) => ({
  concepts: Array.from(
    new Set(
      (value.concepts || []).map((concept) => concept.trim()).filter(Boolean),
    ),
  ),
  cognitiveProcess: (value.cognitiveProcess || "").trim(),
  familyId: value.familyId || "",
  derivedFromQuestionId: value.derivedFromQuestionId || "",
  reviewLessonId: value.reviewLessonId || "",
  misconceptionTags: Object.fromEntries(
    Object.entries(value.misconceptionTags || {})
      .filter(([answer, label]) => options.includes(answer) && label.trim())
      .map(([answer, label]) => [answer, label.trim()]),
  ),
});

export const validateQuizLearningMetadata = (
  value: QuizLearningMetadata,
  options: string[],
) => {
  const normalized = normalizeQuizLearningMetadata(value, options);
  if (
    normalized.concepts.length > 8 ||
    normalized.concepts.some((concept) => concept.length > 60)
  )
    return "핵심 개념은 최대 8개, 각 60자 이내로 입력해 주세요.";
  if (normalized.cognitiveProcess.length > 60)
    return "사고 과정은 60자 이내로 입력해 주세요.";
  const tags = Object.entries(normalized.misconceptionTags);
  if (
    tags.length > 10 ||
    tags.some(([key, label]) => key.length > 500 || label.length > 120)
  )
    return "선지별 혼동 지점은 최대 10개, 각 120자 이내로 입력해 주세요. 선지는 500자 이하여야 합니다.";
  return "";
};

export default QuizLearningMetadataFields;
