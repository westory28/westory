import React, { useEffect, useRef, useState } from "react";
import QuizVisualPassageEditor from "./QuizVisualPassageEditor";
import QuizTextField from "./QuizTextField";
import QuizPassage from "../../../components/common/QuizPassage";
import type { MockExamPassageSet } from "../../../lib/mockExamMaterials";

export interface MockExamSetChoice {
  passageSet: MockExamPassageSet;
  numbers: number[];
}

export const createMockExamSetId = () =>
  `set_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

interface Props {
  round: string;
  exampleEnabled: boolean;
  example: string;
  onExampleEnabledChange: (enabled: boolean) => void;
  onExampleChange: (value: string) => void;
  passageSet: MockExamPassageSet | null;
  linked: boolean;
  onSetChange: (value: MockExamPassageSet | null, linked: boolean) => void;
  loadSets: () => Promise<MockExamSetChoice[]>;
  onSetImage: (file: File) => Promise<void>;
  disabled?: boolean;
}

export default function MockExamMaterialFields({
  round,
  exampleEnabled,
  example,
  onExampleEnabledChange,
  onExampleChange,
  passageSet,
  linked,
  onSetChange,
  loadSets,
  onSetImage,
  disabled = false,
}: Props) {
  const [chooseExisting, setChooseExisting] = useState(false);
  const [choices, setChoices] = useState<MockExamSetChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    request.current += 1;
    setChooseExisting(false);
    setChoices([]);
    setBusy(false);
    setError("");
    return () => {
      request.current += 1;
    };
  }, [round]);
  const update = (patch: Partial<MockExamPassageSet>) => {
    if (passageSet && !linked) onSetChange({ ...passageSet, ...patch }, false);
  };
  const loadExisting = async () => {
    if (busy) return;
    const ticket = ++request.current;
    setChooseExisting(true);
    setBusy(true);
    setError("");
    try {
      const list = await loadSets();
      if (request.current === ticket) setChoices(list);
    } catch {
      if (request.current === ticket)
        setError("세트 지문을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (request.current === ticket) setBusy(false);
    }
  };
  const newSet = () => {
    request.current += 1;
    setBusy(false);
    setChooseExisting(false);
    setError("");
    onSetChange(
      {
        id: createMockExamSetId(),
        instruction: "다음 자료를 읽고 물음에 답하시오.",
        passage: "",
        image: null,
      },
      false,
    );
  };
  return (
    <div className="mock-exam-material-fields">
      <div className="mock-exam-material-actions">
        <button
          type="button"
          className="quiz-authoring-button"
          disabled={disabled}
          aria-pressed={exampleEnabled}
          onClick={() => onExampleEnabledChange(!exampleEnabled)}
        >
          {exampleEnabled ? "보기 없애기" : "〈보기〉 추가"}
        </button>
        {!passageSet && (
          <>
            <button
              type="button"
              className="quiz-authoring-button"
              disabled={disabled}
              onClick={newSet}
            >
              새 세트 지문
            </button>
            <button
              type="button"
              className="quiz-authoring-button"
              disabled={disabled || busy}
              onClick={() => void loadExisting()}
            >
              {busy ? "불러오는 중…" : "기존 세트 연결"}
            </button>
          </>
        )}
      </div>
      {chooseExisting && !passageSet && (
        <div className="mock-exam-set-picker">
          {busy ? (
            <p role="status">세트 지문을 불러오는 중…</p>
          ) : choices.length ? (
            <label className="quiz-composer-field">
              <span>연결할 세트 지문</span>
              <select
                value=""
                disabled={disabled}
                onChange={(event) => {
                  const choice = choices.find(
                    (item) => item.passageSet.id === event.target.value,
                  );
                  if (choice) {
                    onSetChange({ ...choice.passageSet }, true);
                    setChooseExisting(false);
                  }
                }}
              >
                <option value="">세트 선택</option>
                {choices.map((item) => (
                  <option key={item.passageSet.id} value={item.passageSet.id}>
                    {item.numbers.join("·")}번 ·{" "}
                    {item.passageSet.instruction || "공통 지문"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            !error && (
              <p role="status">이 회차에 등록된 세트 지문이 없습니다.</p>
            )
          )}
          {error && (
            <p role="alert">
              {error}{" "}
              <button
                type="button"
                className="quiz-authoring-button"
                onClick={() => void loadExisting()}
              >
                다시 불러오기
              </button>
            </p>
          )}
        </div>
      )}
      {passageSet && (
        <section
          className="mock-exam-shared-editor"
          aria-label="세트 공통 지문"
        >
          <div className="quiz-composer-section-heading">
            <h4>세트 공통 지문</h4>
            <div className="mock-exam-material-actions">
              {linked && (
                <button
                  type="button"
                  disabled={disabled}
                  className="quiz-authoring-button"
                  onClick={() =>
                    onSetChange(
                      { ...passageSet, id: createMockExamSetId() },
                      false,
                    )
                  }
                >
                  별도 세트로 만들기
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                className="quiz-authoring-button"
                onClick={() => onSetChange(null, false)}
              >
                세트 연결 해제
              </button>
            </div>
          </div>
          {linked ? (
            <>
              <p className="mock-exam-shared-instruction">
                {passageSet.instruction}
              </p>
              {passageSet.passage && <QuizPassage value={passageSet.passage} />}
              {passageSet.image && (
                <img
                  src={passageSet.image}
                  alt="연결된 공통 지문 자료"
                  className="mock-exam-shared-image"
                />
              )}
            </>
          ) : (
            <>
              <label className="quiz-composer-field">
                <span>공통 발문</span>
                <QuizTextField
                  grow
                  value={passageSet.instruction}
                  aria-label="공통 발문"
                  maxLength={300}
                  onChange={(event) =>
                    update({ instruction: event.target.value })
                  }
                />
              </label>
              <QuizVisualPassageEditor
                label="공통 지문"
                value={passageSet.passage}
                onChange={(passage) => update({ passage })}
                onImagePaste={onSetImage}
              />
              <label className="quiz-attachment-button">
                공통 자료 이미지 첨부
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="공통 자료 이미지 첨부"
                  disabled={disabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void onSetImage(file);
                  }}
                />
              </label>
              {passageSet.image && (
                <div className="mock-exam-shared-image-row">
                  <img
                    src={passageSet.image}
                    alt="공통 지문 첨부 이미지"
                    className="mock-exam-shared-image"
                  />
                  <button
                    type="button"
                    className="quiz-authoring-button"
                    disabled={disabled}
                    onClick={() => update({ image: null })}
                  >
                    공통 이미지 제거
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {exampleEnabled && (
        <QuizVisualPassageEditor
          label="보기"
          value={example}
          onChange={onExampleChange}
        />
      )}
    </div>
  );
}
