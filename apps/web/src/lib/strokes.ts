type Point = readonly [number, number];

export const medianPath = (points: readonly Point[]): string =>
  points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${String(x)} ${String(y)}`).join(" ");

export const polylineLength = (points: readonly Point[]): number =>
  points.reduce((length, [x, y], index) => {
    const previous = points[index - 1];
    return previous ? length + Math.hypot(x - previous[0], y - previous[1]) : length;
  }, 0);

/** Drawing time of a stroke in ms: long strokes take longer, short ones stay visible. */
export const strokeDuration = (length: number): number => Math.round((length + 600) / 3);
