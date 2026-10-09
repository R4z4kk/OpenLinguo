export type SegmentedOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  /** `lang` of the label when it is not in the interface language. */
  readonly lang: string | null;
};

type Props<Value extends string> = {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly failure: string | null;
};

/** Radio group drawn as a segmented control: native keyboard and screen reader support. */
export const SegmentedControl = <Value extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  failure,
}: Props<Value>) => (
  <fieldset>
    <legend className="font-semibold">{legend}</legend>
    <div className="mt-3 inline-flex gap-1 rounded-control border border-border-strong bg-surface p-1">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-11 cursor-pointer items-center rounded-control px-4 has-checked:bg-ink has-checked:font-semibold has-checked:text-on-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
            className="sr-only"
          />
          <span {...(option.lang === null ? {} : { lang: option.lang })}>{option.label}</span>
        </label>
      ))}
    </div>
    {failure !== null && (
      <p role="alert" className="mt-2 text-danger">
        {failure}
      </p>
    )}
  </fieldset>
);
