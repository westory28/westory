import { useEffect, useId, useState } from "react";
import { HISTORY_DICTIONARY_HANGUL_INITIALS } from "../../lib/historyDictionaryInitials";
import "./historyDictionaryInitialFilter.css";

export interface HistoryDictionaryInitialFilterProps {
  value: string;
  onChange: (value: string) => void;
  counts?: Record<string, number>;
  label?: string;
  disabled?: boolean;
}

const digits = Array.from({ length: 10 }, (_, index) => String(index));
const letters = Array.from({ length: 26 }, (_, index) =>
  String.fromCharCode(97 + index),
);

export default function HistoryDictionaryInitialFilter({
  value,
  onChange,
  counts,
  label = "첫 글자로 찾기",
  disabled = false,
}: HistoryDictionaryInitialFilterProps) {
  const id = useId();
  const [numbersOpen, setNumbersOpen] = useState(
    value === "0-9" || /^[0-9]$/.test(value),
  );
  const [lettersOpen, setLettersOpen] = useState(
    value === "a-z" || /^[a-z]$/.test(value),
  );

  useEffect(() => {
    if (!value) {
      setNumbersOpen(false);
      setLettersOpen(false);
    }
    if (/^[0-9]$/.test(value)) setNumbersOpen(true);
    if (/^[a-z]$/.test(value)) setLettersOpen(true);
  }, [value]);

  const accessibleLabel = (initial: string) =>
    `${initial || "전체"}${counts ? ` · ${counts[initial] || 0}개` : ""}`;
  const character = (initial: string) => (
    <button
      key={initial}
      type="button"
      className="history-dictionary-initial-button"
      aria-label={accessibleLabel(initial)}
      title={accessibleLabel(initial)}
      aria-pressed={value === initial}
      disabled={disabled}
      onClick={() => onChange(initial)}
    >
      {initial}
    </button>
  );

  return (
    <nav className="history-dictionary-initial-filter" aria-label={label}>
      <div className="history-dictionary-initial-items">
        <button
          type="button"
          className="history-dictionary-initial-button history-dictionary-initial-all"
          aria-label={accessibleLabel("")}
          aria-pressed={!value}
          disabled={disabled}
          onClick={() => onChange("")}
        >
          전체
        </button>
        <div className="history-dictionary-initial-group">
          <button
            type="button"
            className="history-dictionary-initial-button history-dictionary-initial-group-button"
            aria-label={`${accessibleLabel("0-9")} · 숫자 ${numbersOpen ? "접기" : "펼치기"}`}
            aria-pressed={value === "0-9"}
            aria-expanded={numbersOpen}
            aria-controls={`${id}-numbers`}
            disabled={disabled}
            onClick={() => {
              setNumbersOpen((open) => !open);
              onChange("0-9");
            }}
          >
            0-9<span aria-hidden="true">{numbersOpen ? "−" : "+"}</span>
          </button>
          <div
            id={`${id}-numbers`}
            className="history-dictionary-initial-expanded"
            hidden={!numbersOpen}
          >
            {digits.map(character)}
          </div>
        </div>
        {HISTORY_DICTIONARY_HANGUL_INITIALS.map(character)}
        <div className="history-dictionary-initial-group">
          <button
            type="button"
            className="history-dictionary-initial-button history-dictionary-initial-group-button"
            aria-label={`${accessibleLabel("a-z")} · 영문 ${lettersOpen ? "접기" : "펼치기"}`}
            aria-pressed={value === "a-z"}
            aria-expanded={lettersOpen}
            aria-controls={`${id}-letters`}
            disabled={disabled}
            onClick={() => {
              setLettersOpen((open) => !open);
              onChange("a-z");
            }}
          >
            a-z<span aria-hidden="true">{lettersOpen ? "−" : "+"}</span>
          </button>
          <div
            id={`${id}-letters`}
            className="history-dictionary-initial-expanded"
            hidden={!lettersOpen}
          >
            {letters.map(character)}
          </div>
        </div>
      </div>
    </nav>
  );
}
