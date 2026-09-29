import React, { useLayoutEffect, useRef } from "react";
import { normalizeKoreanTextSelection } from "../../../lib/koreanText";

type KoreanTextInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** Keep native IME composition intact; repair detached jamo once it commits. */
const KoreanTextInput: React.FC<KoreanTextInputProps> = ({
  value,
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  ...props
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const selectionRef = useRef<{
    value: string;
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null>(null);

  const commitValue = (input: HTMLInputElement) => {
    const raw = input.value;
    const next = normalizeKoreanTextSelection(
      raw,
      input.selectionStart ?? raw.length,
      input.selectionEnd ?? raw.length,
    );
    if (next.value !== raw) {
      const direction = input.selectionDirection || "none";
      selectionRef.current = {
        value: next.value,
        start: next.selectionStart,
        end: next.selectionEnd,
        direction,
      };
      // The normalized value can equal the previous prop (and cause no render).
      // Update this input as well so React never leaves detached jamo visible.
      input.value = next.value;
      input.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
        direction,
      );
    } else {
      selectionRef.current = null;
    }
    onValueChange(next.value);
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    const selection = selectionRef.current;
    if (
      input &&
      selection &&
      !composingRef.current &&
      value === selection.value &&
      document.activeElement === input
    ) {
      input.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
      selectionRef.current = null;
    }
  }, [value]);

  return (
    <input
      {...props}
      type="text"
      ref={inputRef}
      value={value}
      onChange={(event) => {
        if (
          composingRef.current ||
          (event.nativeEvent as InputEvent).isComposing
        ) {
          composingRef.current = true;
          selectionRef.current = null;
          onValueChange(event.currentTarget.value);
          return;
        }
        commitValue(event.currentTarget);
      }}
      onCompositionStart={(event) => {
        composingRef.current = true;
        selectionRef.current = null;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        commitValue(event.currentTarget);
        onCompositionEnd?.(event);
      }}
      onBlur={(event) => {
        if (!composingRef.current) commitValue(event.currentTarget);
        onBlur?.(event);
      }}
    />
  );
};

export default KoreanTextInput;
