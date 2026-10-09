import { err, ok, type Result } from "@openlinguo/core";

export type Rgb = readonly [number, number, number];
type Matrix = readonly [Rgb, Rgb, Rgb];

export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

/**
 * Severity 1.0 matrices of Machado, Oliveira and Fernandes (2009), applied to linear sRGB.
 * Source: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 */
const MACHADO_2009: Readonly<Record<Exclude<Vision, "normal">, Matrix>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** sRGB (IEC 61966-2-1) to CIE XYZ, D65 white. */
const SRGB_TO_XYZ: Matrix = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const D65_WHITE: Rgb = [0.95047, 1, 1.08883];

const map = (rgb: Rgb, transform: (value: number) => number): Rgb => [
  transform(rgb[0]),
  transform(rgb[1]),
  transform(rgb[2]),
];

const dot = (row: Rgb, rgb: Rgb): number => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2];

const multiply = (matrix: Matrix, rgb: Rgb): Rgb => [
  dot(matrix[0], rgb),
  dot(matrix[1], rgb),
  dot(matrix[2], rgb),
];

export const parseHex = (hex: string): Result<Rgb, string> => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match?.[1] == null || match[2] == null || match[3] == null) {
    return err(`not a #rrggbb color: ${hex}`);
  }
  const channel = (text: string): number => parseInt(text, 16) / 255;
  return ok([channel(match[1]), channel(match[2]), channel(match[3])]);
};

/** WCAG 2.2 linearization, threshold 0.04045: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance */
const linear = (rgb: Rgb): Rgb =>
  map(rgb, (channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

/** WCAG 2.x contrast ratio, from 1 to 21. */
export const contrastRatio = (first: Rgb, second: Rgb): number => {
  const a = dot(SRGB_TO_XYZ[1], linear(first));
  const b = dot(SRGB_TO_XYZ[1], linear(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const simulate = (rgb: Rgb, vision: Vision): Rgb =>
  vision === "normal"
    ? linear(rgb)
    : map(multiply(MACHADO_2009[vision], linear(rgb)), (channel) =>
        Math.min(1, Math.max(0, channel)),
      );

/** CIE 1976 L*a*b* (D65) of a linear sRGB color. */
const lab = (linearRgb: Rgb): Rgb => {
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [x, y, z] = multiply(SRGB_TO_XYZ, linearRgb);
  const [fx, fy, fz] = [f(x / D65_WHITE[0]), f(y / D65_WHITE[1]), f(z / D65_WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

/** Smallest CIE76 ΔE between any two colors, as seen with the given vision. */
export const smallestDeltaE = (colors: readonly Rgb[], vision: Vision): number => {
  const labs = colors.map((color) => lab(simulate(color, vision)));
  let smallest = Number.POSITIVE_INFINITY;
  for (const [index, a] of labs.entries()) {
    for (const b of labs.slice(index + 1)) {
      smallest = Math.min(smallest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return smallest;
};
