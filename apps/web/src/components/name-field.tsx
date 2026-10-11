import { useId } from "react";
import { DECK_NAME_MAX } from "@/data/decks";

/** A deck name input; `problem` is announced and describes the input. */
export const NameField = ({
  label,
  value,
  onChange,
  problem,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly problem: string | null;
}) => {
  const inputId = useId();
  const problemId = useId();
  return (
    <div className="max-w-sm">
      <label htmlFor={inputId} className="font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        maxLength={DECK_NAME_MAX}
        autoComplete="off"
        aria-invalid={problem !== null}
        {...(problem === null ? {} : { "aria-describedby": problemId })}
        className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body"
      />
      {problem !== null && (
        <p id={problemId} role="alert" className="mt-2 text-danger">
          {problem}
        </p>
      )}
    </div>
  );
};
