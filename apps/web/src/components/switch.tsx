import { useId } from "react";
import { cn } from "@/lib/utils";

/** An on/off setting: the thumb's side tells the state as well as the fill. `hint`: its description. */
export const Switch = ({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly hint: string | null;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) => {
  const hintId = useId();
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        {...(hint === null ? {} : { "aria-describedby": hintId })}
        onClick={() => {
          onChange(!checked);
        }}
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control pe-2 text-start font-semibold"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-[26px] w-11 flex-none items-center rounded-full border-2 p-0.5",
            checked
              ? "justify-end border-ink bg-ink"
              : "justify-start border-border-strong bg-surface",
          )}
        >
          <span
            className={cn("size-[18px] rounded-full", checked ? "bg-on-ink" : "bg-border-strong")}
          />
        </span>
        {label}
      </button>
      {hint !== null && (
        <p id={hintId} className="ms-14 text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
};
