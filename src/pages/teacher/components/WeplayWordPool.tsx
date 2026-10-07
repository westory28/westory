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
      };
      item.sources.push(
        `${lesson.title || "제목 없는 수업 자료"} · ${lesson.isVisibleToStudents ? "공개" : "비공개"}`,
      );
      item.public ||= lesson.isVisibleToStudents;
      pool.set(key, item);
    }
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
          비공개 자료의 빈칸 정답은 교사 체험에만 사용됩니다.
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
                    {word.sources.join(" / ")}
                    {excluded.has(word.key) && " · 제외됨"}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!filtered.length && (
          <p>
            {query
              ? "검색 결과가 없습니다."
              : "연결한 수업 자료에 빈칸 정답이 없습니다."}
          </p>
        )}
      </div>
    </details>
  );
}
