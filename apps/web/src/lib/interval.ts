const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS = [
  ["year", 365 * DAY],
  ["month", 30 * DAY],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
] as const;

/** A wait in its largest unit ("10 min", "3 days", "1.5 mths"), at least one minute. */
export const formatInterval = (milliseconds: number, locale: string): string => {
  const [unit, size] = UNITS.find(([, length]) => milliseconds >= length) ?? ["minute", MINUTE];
  const value = Math.max(1, milliseconds / size);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "month" || unit === "year" ? 1 : 0,
  }).format(value);
};

const unit = (value: number, name: "minute" | "second", locale: string): string =>
  new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }).format(value);

/** A time spent in minutes and seconds ("1 min 25 sec"), to the nearest second. */
export const formatDuration = (milliseconds: number, locale: string): string => {
  const total = Math.round(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return unit(seconds, "second", locale);
  return seconds === 0
    ? unit(minutes, "minute", locale)
    : `${unit(minutes, "minute", locale)} ${unit(seconds, "second", locale)}`;
};

/** A countdown as minutes:seconds ("1:05"), rounded up so it shows 0:00 only at the end. */
export const formatClock = (milliseconds: number): string => {
  const total = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
};
