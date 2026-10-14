const MEGABYTE = 1_000_000;

/** `1.2 MB`, `340 kB` in the interface language. */
export const formatSize = (bytes: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: "unit",
    unit: bytes >= MEGABYTE ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= MEGABYTE ? MEGABYTE : 1000));
