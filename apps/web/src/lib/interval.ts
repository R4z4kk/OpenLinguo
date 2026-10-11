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
