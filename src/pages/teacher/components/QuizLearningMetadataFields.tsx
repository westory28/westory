import React, { useEffect, useId, useRef, useState } from "react";
import { getQuestionCognitiveProcesses } from "../../../lib/cognitiveProcesses";
import "./QuizLearningMetadataFields.css";
import {
  normalizeHistoryAchievementMetadata,
  validateHistoryAchievementMetadata,
  type HistoryAchievementMetadata,
} from "../../../lib/historyAchievement";

export interface QuizLearningMetadata extends HistoryAchievementMetadata {
  concepts?: string[];
  cognitiveProcess?: string;
  cognitiveProcesses?: string[];
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

function CognitiveProcessSelect({
  value,
  onChange,
}: Pick<Props, "value" | "onChange">) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = getQuestionCognitiveProcesses(value);
  const legacyOptions = useRef(new Set<string>());
  selected
    .filter((item) => !COGNITIVE_PROCESS_OPTIONS.includes(item))
    .forEach((item) => legacyOptions.current.add(item));
  const choices = [...COGNITIVE_PROCESS_OPTIONS, ...legacyOptions.current];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return (
    <div
      ref={root}
      className="quiz-cognitive-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <label htmlFor={id}>사고 과정</label>
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label="사고 과정 선택"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        title={selected.join(", ") || "미지정"}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.join(", ") || "미지정"}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d={open ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"} />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-options`}
          className="quiz-cognitive-options"
          role="group"
          aria-label="사고 과정 항목"
        >
          {choices.map((item) => (
            <label key={item}>
              <input
                type="checkbox"
                checked={selected.includes(item)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, item]
                    : selected.filter((current) => current !== item);
                  onChange({
                    ...value,
                    cognitiveProcess: next[0] || "",
                    cognitiveProcesses: next,
                  });
                }}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
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
      <CognitiveProcessSelect value={value} onChange={onChange} />
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
  ...normalizeHistoryAchievementMetadata(value),
  concepts: Array.from(
    new Set(
      (value.concepts || []).map((concept) => concept.trim()).filter(Boolean),
    ),
  ),
  cognitiveProcess: getQuestionCognitiveProcesses(value)[0] || "",
  cognitiveProcesses: getQuestionCognitiveProcesses(value),
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
  const achievementError = validateHistoryAchievementMetadata(value);
  if (achievementError) return achievementError;
  const normalized = normalizeQuizLearningMetadata(value, options);
  if (
    normalized.concepts.length > 8 ||
    normalized.concepts.some((concept) => concept.length > 60)
  )
    return "핵심 개념은 최대 8개, 각 60자 이내로 입력해 주세요.";
  if (
    normalized.cognitiveProcesses.length > 8 ||
    normalized.cognitiveProcesses.some((item) => item.length > 60)
  )
    return "사고 과정은 최대 8개, 각 60자 이내로 선택해 주세요.";
  const tags = Object.entries(normalized.misconceptionTags);
  if (
    tags.length > 10 ||
    tags.some(([key, label]) => key.length > 500 || label.length > 120)
  )
    return "선지별 혼동 지점은 최대 10개, 각 120자 이내로 입력해 주세요. 선지는 500자 이하여야 합니다.";
  return "";
};

export default QuizLearningMetadataFields;
