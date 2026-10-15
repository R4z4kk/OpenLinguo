import type { ToneModel } from "./tone-classifier.ts";

/**
 * Trained by `pnpm --filter @openlinguo/data-pipeline tone-model` on data/tone-fixtures (ADR 0007);
 * a test fails when the fixtures change and this file does not.
 */
export const TONE_MODEL: ToneModel = {
  centroids: [
    [9.5, 6.1, -0.3, -0.1, -1, -1.1, -0.5, 0.2, 0.5, 4.3, 2],
    [14.4, 1.7, -5.2, -10.4, -11.3, -6.6, 10.2, 24.2, 39.1, 41.3, 3.6],
    [21, 5.4, -2.9, -2.9, -6, 1, 3.9, 4.2, 16.7, 25.5, 14.9],
    [22.9, 19.9, 15.7, 8.1, -4.3, -17.4, -29.2, -33, -32.8, -28.6, 15],
  ],
  scale: [34.9, 30.7, 25.9, 22.9, 24, 31.3, 38.1, 36.7, 44.3, 47.5, 13.5],
};
