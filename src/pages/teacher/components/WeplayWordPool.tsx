import React, { useMemo, useState } from "react";
import {
  normalizeWeplayAnswer,
  type WeplayGameSettings,
  type WeplayManagement,
} from "../../../lib/weplay";

export function getWeplayWordPool(
  lessons: WeplayManagement["lessons"],
  settings: WeplayGameSettings,
) {
  const pool = new Map<
    string,
    {
      key: string;
      text: string;
      sources: string[];
      public: boolean;
      custom: boolean;
    }
  >();
  for (const lesson of lessons) {
    if (
      settings.sourceMode === "selected" &&
      !settings.unitIds.includes(lesson.unitId)
    )
      continue;
    for (const text of lesson.words) {
      const key = normalizeWeplayAnswer(text);
      const item = pool.get(key) || {
        key,
        text,
        sources: [],
        public: false,
        custom: false,
      };
      item.sources.push(
        `${lesson.title || "제목 없는 수업 자료"} · ${lesson.isVisibleToStudents ? "공개" : "비공개"}`,
      );
      item.public ||= lesson.isVisibleToStudents;
      pool.set(key, item);
    }
  }
  for (const text of settings.customWords) {
    const key = normalizeWeplayAnswer(text);
    const item = pool.get(key) || {
      key,
      text,
      sources: [],
      public: false,
      custom: false,
    };
    item.custom = true;
    item.public = true;
    pool.set(key, item);
  }
  return [...pool.values()];
}

export default function WeplayWordPool({
  lessons,
  settings,
  disabled,
  update,
}: {
  lessons: WeplayManagement["lessons"];
  settings: WeplayGameSettings;
  disabled: boolean;
  update: (next: Partial<WeplayGameSettings>) => void;
}) {
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState("");
  const words = useMemo(
    () => getWeplayWordPool(lessons, settings),
    [lessons, settings],
  );
  const excluded = new Set(settings.excludedWords);
  const selected = words.filter((word) => !excluded.has(word.key));
  const query = normalizeWeplayAnswer(search);
  const filtered = words.filter(
    (word) =>
      word.key.includes(query) ||
      normalizeWeplayAnswer(word.sources.join(" ")).includes(query),
  );
  const add = () => {
    if (disabled) return;
    const text = manual.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = normalizeWeplayAnswer(text);
    if (
      !key ||
      Array.from(text).length > 12 ||
      !/[\p{L}\p{N}]/u.test(text) ||
      /[<>\u0000-\u001f\u007f]/.test(manual) ||
      /[<>]/.test(text) ||
      text.startsWith("fn:")
    ) {
      setMessage(
        "단어는 글자나 숫자를 포함해 1~12자로 입력해 주세요. <, >, 제어 문자 및 fn:으로 시작하는 단어는 사용할 수 없습니다.",
      );
      return;
    }
    if (
      settings.customWords.some((word) => normalizeWeplayAnswer(word) === key)
    ) {
      setMessage("이미 직접 추가한 단어입니다.");
      return;
    }
    if (words.some((word) => word.key === key && word.public)) {
      if (excluded.has(key)) {
        update({
          excludedWords: settings.excludedWords.filter((word) => word !== key),
        });
        setManual("");
        setMessage("기존 단어를 다시 포함했습니다.");
      } else setMessage("이미 단어 모음에 포함되어 있습니다.");
      return;
    }
    if (settings.customWords.length >= 1000) {
      setMessage("직접 추가할 수 있는 단어는 최대 1,000개입니다.");
      return;
    }
    update({
      customWords: [...settings.customWords, text],
      excludedWords: settings.excludedWords.filter((word) => word !== key),
    });
    setManual("");
    setMessage("단어를 추가했습니다. 게임 설정을 저장하면 적용됩니다.");
  };
  return (
    <details className="teacher-weplay-pool">
      <summary>
        <span>단어 모음</span>
        <span className="teacher-weplay-note">
          포함 {selected.length}개 · 제외 {words.length - selected.length}개
        </span>
      </summary>
      <div className="teacher-weplay-pool-body">
        <fieldset className="teacher-weplay-sources" disabled={disabled}>
          <legend>수업 자료 연결</legend>
          <label>
            <input
              type="radio"
              name="weplay-source-mode"
              checked={settings.sourceMode === "all"}
              onChange={() => update({ sourceMode: "all", unitIds: [] })}
            />
            전체 수업 자료
          </label>
          <label>
            <input
              type="radio"
              name="weplay-source-mode"
              checked={settings.sourceMode === "selected"}
              onChange={() =>
                update({
                  sourceMode: "selected",
                  unitIds: lessons.map((lesson) => lesson.unitId),
                })
              }
            />
            선택한 수업 자료
          </label>
        </fieldset>
        {settings.sourceMode === "selected" && (
          <div
            className="teacher-weplay-source-grid"
            role="group"
            aria-label="출제 자료 선택"
          >
            {lessons.map((lesson) => (
              <label key={lesson.unitId}>
                <input
                  type="checkbox"
                  checked={settings.unitIds.includes(lesson.unitId)}
                  disabled={disabled}
                  aria-label={`${lesson.title || "제목 없는 수업 자료"} 출제 포함`}
                  onChange={(event) =>
                    update({
                      unitIds: event.target.checked
                        ? [...settings.unitIds, lesson.unitId]
                        : settings.unitIds.filter((id) => id !== lesson.unitId),
                    })
                  }
                />
                <span>
                  {lesson.title || "제목 없는 수업 자료"}
                  <small>
                    {lesson.isVisibleToStudents ? "공개" : "비공개"} ·{" "}
                    {lesson.wordCount}개
                  </small>
                </span>
              </label>
            ))}
            {!lessons.length && <p>등록된 수업 자료가 없습니다.</p>}
          </div>
        )}
        <p className="teacher-weplay-note">
          비공개 자료의 단어는 교사 체험에만 사용됩니다. 직접 추가한 단어는
          학생에게도 출제됩니다.
        </p>
        <div className="teacher-weplay-word-tools">
          <label>
            단어·자료 검색
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </label>
          <div className="teacher-weplay-word-add">
            <label>
              단어 직접 추가
              <input
                type="text"
                value={manual}
                disabled={disabled}
                onChange={(event) => {
                  setManual(event.target.value);
                  setMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="teacher-weplay-button"
              disabled={disabled || !manual.trim()}
              onClick={add}
            >
              추가
            </button>
          </div>
        </div>
        {message && (
          <p role="status" className="teacher-weplay-note">
            {message}
          </p>
        )}
        <div className="teacher-weplay-word-status">
          <span>검색 {filtered.length}개</span>
          <span>체크한 단어만 출제</span>
        </div>
        <ul className="teacher-weplay-words">
          {filtered.map((word) => (
            <li
              key={word.key}
              className={excluded.has(word.key) ? "is-excluded" : undefined}
            >
              <label>
                <input
                  type="checkbox"
                  aria-label={`${word.text} 출제 포함`}
                  checked={!excluded.has(word.key)}
                  disabled={disabled}
                  onChange={(event) => {
                    if (
                      !event.target.checked &&
                      settings.excludedWords.length >= 1000
                    ) {
                      setMessage("제외할 수 있는 단어는 최대 1,000개입니다.");
                      return;
                    }
                    update({
                      excludedWords: event.target.checked
                        ? settings.excludedWords.filter(
                            (key) => key !== word.key,
                          )
                        : [...settings.excludedWords, word.key],
                    });
                  }}
                />
                <span>
                  <strong>{word.text}</strong>
                  <small>
                    {word.custom && "직접 추가"}
                    {word.custom && word.sources.length > 0 && " · "}
                    {word.sources.join(" / ")}
                    {excluded.has(word.key) && " · 제외됨"}
                  </small>
                </span>
              </label>
              {word.custom && (
                <button
                  type="button"
                  className="teacher-weplay-button is-danger"
                  disabled={disabled}
                  aria-label={`${word.text} 직접 추가 삭제`}
                  onClick={() =>
                    update({
                      customWords: settings.customWords.filter(
                        (text) => normalizeWeplayAnswer(text) !== word.key,
                      ),
                      excludedWords: settings.excludedWords.filter(
                        (key) => key !== word.key,
                      ),
                    })
                  }
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
        {!filtered.length && (
          <p>
            {query
              ? "검색 결과가 없습니다."
              : "연결한 자료의 빈칸 단어가 없습니다. 단어를 직접 추가할 수 있습니다."}
          </p>
        )}
      </div>
    </details>
  );
}
