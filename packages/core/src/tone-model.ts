import type { ToneModel } from "./tone-classifier.ts";

/**
 * Trained by `pnpm --filter @openlinguo/data-pipeline tone-model` on data/tone-fixtures (ADR 0007);
 * a test fails when the fixtures change and this file does not.
 */
export const TONE_MODEL: ToneModel = {
  centroids: [
    [9.7, 5.3, 1.6, -0.8, -1.3, -0.9, -0.2, 0.3, 1, 7.9, 1.1],
    [8.3, -3.2, -11.2, -12.4, -7.9, 2, 16.5, 28, 43, 46.3, 5.9],
    [5.7, -3.3, 1.2, -7.5, 2.4, 4.7, 4.6, 5.2, 16.9, 22.2, 20],
    [18.1, 14.9, 10.8, 7.1, 0.7, -3.6, -15.3, -20.8, -18.9, -10.3, 22.5],
  ],
  scale: [36.2, 31.9, 27.4, 26.5, 32.5, 38.3, 37.7, 37.9, 43.3, 51.8, 16.5],
};
