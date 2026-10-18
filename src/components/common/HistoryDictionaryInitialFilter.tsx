import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import {
  attachHistoryDictionaryInitialDrag,
  getHistoryDictionaryInitialItems,
  getHistoryDictionaryInitialWindow,
} from "../../lib/historyDictionaryInitialDrag";
import "./historyDictionaryInitialFilter.css";

export interface HistoryDictionaryInitialFilterProps {
  value: string;
  onChange: (value: string) => void;
  counts?: Record<string, number>;
  label?: string;
  disabled?: boolean;
}

export default function HistoryDictionaryInitialFilter({
  value,
  onChange,
  counts,
  label = "첫 글자로 찾기",
  disabled = false,
}: HistoryDictionaryInitialFilterProps) {
  const id = useId();
  const railRef = useRef<HTMLElement>(null);
  const dragRef =
    useRef<ReturnType<typeof attachHistoryDictionaryInitialDrag>>();
  const [capacity, setCapacity] = useState(8);
  const [numbersOpen, setNumbersOpen] = useState(
    value === "0-9" || /^[0-9]$/.test(value),
  );
  const [lettersOpen, setLettersOpen] = useState(
    value === "a-z" || /^[a-z]$/.test(value),
  );
  const [focusRequest, setFocusRequest] = useState(0);
  const focusInitial = useRef<string>();
  const items = getHistoryDictionaryInitialItems(numbersOpen, lettersOpen);
  const rows = getHistoryDictionaryInitialWindow(items, value, capacity);
  const live = useRef({ value, disabled, onChange, items });
  live.current = { value, disabled, onChange, items };

  const select = (initial: string, focus = false) => {
    live.current.value = initial;
    live.current.onChange(initial);
    if (focus) {
      focusInitial.current = initial;
      setFocusRequest((request) => request + 1);
    }
  };
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const controller = attachHistoryDictionaryInitialDrag(rail, {
      isDisabled: () => live.current.disabled,
      getItems: () => live.current.items,
      getValue: () => live.current.value,
      onSelect: (initial, focus) => selectRef.current(initial, focus),
      onFocus: (initial) => {
        focusInitial.current = initial;
        setFocusRequest((request) => request + 1);
      },
      onCapacityChange: setCapacity,
    });
    dragRef.current = controller;
    return () => {
      controller.dispose();
      dragRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (disabled) dragRef.current?.cancel();
  }, [disabled]);
  useEffect(() => {
    dragRef.current?.refresh();
  }, [items.length]);
  useEffect(() => {
    if (!value) {
      setNumbersOpen(false);
      setLettersOpen(false);
    }
    if (/^[0-9]$/.test(value)) setNumbersOpen(true);
    if (/^[a-z]$/.test(value)) setLettersOpen(true);
  }, [value]);
  useEffect(() => {
    const initial = focusInitial.current;
    if (initial === undefined) return;
    const button = [
      ...(railRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-history-initial]",
      ) ?? []),
    ].find((item) => item.getAttribute("data-history-initial") === initial);
    button?.focus({ preventScroll: true });
    focusInitial.current = undefined;
  }, [focusRequest, value, capacity]);

  const accessibleLabel = (initial: string) =>
    `${initial || "전체"}${counts ? ` · ${counts[initial] || 0}개` : ""}`;
  return (
    <nav
      ref={railRef}
      className="history-dictionary-initial-filter"
      aria-label={label}
      style={
        {
          "--history-dictionary-rail-item-count": items.length,
        } as CSSProperties
      }
    >
      <div id={`${id}-window`} className="history-dictionary-initial-items">
        {rows.map((row) => {
          if (row.type === "more")
            return (
              <button
                key={`more-${row.direction}`}
                type="button"
                className="history-dictionary-initial-button history-dictionary-initial-more"
                data-history-initial-more-target={row.target}
                aria-label={`${row.direction < 0 ? "이전" : "다음"} 숨긴 글자 보기 · ${row.target || "전체"}`}
                title={row.direction < 0 ? "이전 글자" : "다음 글자"}
                disabled={disabled}
                onClick={() => select(row.target, true)}
              >
                <span aria-hidden="true">…</span>
              </button>
            );
          const initial = row.value;
          const group = initial === "0-9" || initial === "a-z";
          const expanded = initial === "0-9" ? numbersOpen : lettersOpen;
          return (
            <button
              key={`initial-${initial}`}
              type="button"
              className={`history-dictionary-initial-button${group ? " history-dictionary-initial-group-button" : ""}${initial === "a-z" ? " history-dictionary-initial-end" : ""}`}
              data-history-initial={initial}
              data-history-initial-character={
                !group && initial ? "" : undefined
              }
              aria-label={
                group
                  ? `${accessibleLabel(initial)} · ${initial === "0-9" ? "숫자" : "영문"} ${expanded ? "접기" : "펼치기"}`
                  : accessibleLabel(initial)
              }
              title={accessibleLabel(initial)}
              aria-pressed={value === initial}
              aria-expanded={group ? expanded : undefined}
              aria-controls={group ? `${id}-window` : undefined}
              disabled={disabled}
              onClick={() => {
                if (initial === "0-9") setNumbersOpen((open) => !open);
                if (initial === "a-z") setLettersOpen((open) => !open);
                select(initial);
              }}
            >
              {initial || "전체"}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
