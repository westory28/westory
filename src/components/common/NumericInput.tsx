import React, { forwardRef, useLayoutEffect, useRef, useState } from "react";

export interface NumericInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Use only when the parent deliberately stores an empty string. */
  allowEmpty?: boolean;
}

/** Keep the editable number separate from the parent's validated number. */
const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    {
      value,
      allowEmpty = false,
      onChange,
      onFocus,
      onBlur,
      disabled,
      readOnly,
      ...props
    },
    ref,
  ) {
    const [draft, setDraft] = useState<{ value: string } | null>(null);
    const ownChange = useRef(false);
    const previousValue = useRef(value);
    const controlled = value !== undefined && value !== null;

    useLayoutEffect(() => {
      // A synchronous parent clamp belongs to this keystroke; unrelated
      // updates (for example selecting a different record) replace the draft.
      if (
        disabled ||
        readOnly ||
        (!ownChange.current && !Object.is(value, previousValue.current))
      ) {
        setDraft(null);
      }
      previousValue.current = value;
      ownChange.current = false;
    });

    return (
      <input
        {...props}
        ref={ref}
        type="number"
        value={controlled ? (draft?.value ?? value) : value}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={(event) => {
          if (controlled && !disabled && !readOnly)
            setDraft({ value: event.currentTarget.value });
          onFocus?.(event);
        }}
        onChange={(event) => {
          if (!controlled) {
            onChange?.(event);
            return;
          }
          const next = event.currentTarget.value;
          ownChange.current = true;
          setDraft({ value: next });
          // Native number fields report an empty value while '-' or an
          // exponent is incomplete. That is not a deliberate empty value.
          if (event.currentTarget.validity.badInput) return;
          if (next === "") {
            if (allowEmpty) onChange?.(event);
          } else if (Number.isFinite(Number(next))) {
            onChange?.(event);
          }
        }}
        onBlur={(event) => {
          setDraft(null);
          ownChange.current = false;
          onBlur?.(event);
        }}
      />
    );
  },
);

export default NumericInput;
