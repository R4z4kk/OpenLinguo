import { type Ref, useId } from "react";
import { fieldClass } from "@/shell/ai-settings";

/** One field for a typed code (ADR 0015: no link, so it works in the installed PWA). */
export const CodeField = ({
  label,
  value,
  onChange,
  error,
  numeric,
  maxLength,
  inputRef,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  /** A TOTP or emailed code; a backup code has letters. */
  readonly numeric: boolean;
  readonly maxLength: number;
  readonly inputRef: Ref<HTMLInputElement> | null;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        value={value}
        inputMode={numeric ? "numeric" : "text"}
        autoComplete={numeric ? "one-time-code" : "off"}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={maxLength}
        aria-invalid={error !== null}
        {...(error === null ? {} : { "aria-describedby": `${id}-error` })}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        className={`${fieldClass} max-w-xs font-mono tracking-widest`}
      />
      {error !== null && (
        <p id={`${id}-error`} className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
