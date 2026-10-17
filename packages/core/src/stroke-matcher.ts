/*!
 * `strokeMatches` and its geometry helpers, ported from Hanzi Writer 3.7.3 (`dist/index.esm.js`,
 * https://github.com/chanind/hanzi-writer) to typed, pure functions over `StrokeData`. Leniency is a
 * parameter; the other options keep their defaults, with no character outline shown (Hanzi Writer's
 * quiz shows one by default). `/*!` marks this notice as a legal comment for bundlers.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 David Chanin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import type { StrokeData } from "./language-pack.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * In the stroke data's box: x from 0 to 1024, y up from -124 to 900. A point (x, y) of the word
 * page's `viewBox="0 0 1024 1024"` is `[x, 900 - y]`.
 */
export type StrokePoint = readonly [x: number, y: number];

/** `backwards` is a miss that would match drawn the other way. */
export type StrokeMatch = "match" | "backwards" | "miss";

export type StrokeMatchError = { readonly kind: "no-stroke"; readonly index: number };

/** Bigger is more lenient; Hanzi Writer's default, kept against the spike of ADR 0011. */
export const STROKE_LENIENCY = 1;

const COSINE_SIMILARITY_THRESHOLD = 0; // -1 to 1, smaller = more lenient
const START_AND_END_DIST_THRESHOLD = 250; // bigger = more lenient
const FRECHET_THRESHOLD = 0.4; // bigger = more lenient
const MIN_LEN_THRESHOLD = 0.35; // smaller = more lenient
const AVERAGE_DISTANCE_THRESHOLD = 350;
const SHAPE_FIT_ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16];

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => value + sum, 0) / values.length;

// Points are read by index in the helpers below: destructuring a tuple is several times slower.
const subtract = (p1: StrokePoint, p2: StrokePoint): StrokePoint => [p1[0] - p2[0], p1[1] - p2[1]];

const magnitude = (point: StrokePoint): number => Math.sqrt(point[0] ** 2 + point[1] ** 2);

const distance = (point1: StrokePoint, point2: StrokePoint): number =>
  magnitude(subtract(point1, point2));

const equals = (p1: StrokePoint, p2: StrokePoint): boolean => p1[0] === p2[0] && p1[1] === p2[1];

/** The first and last points, `null` for an empty curve. */
const ends = (curve: readonly StrokePoint[]): readonly [StrokePoint, StrokePoint] | null => {
  const first = curve.at(0) ?? null;
  const last = curve.at(-1) ?? null;
  return first === null || last === null ? null : [first, last];
};

/** The direction of each segment of the line through the points. */
const getEdgeVectors = (points: readonly StrokePoint[]): readonly StrokePoint[] =>
  points.slice(1).map((point, index) => subtract(point, points[index] ?? point));

const length = (points: readonly StrokePoint[]): number =>
  getEdgeVectors(points).reduce((sum, vector) => sum + magnitude(vector), 0);

const cosineSimilarity = (point1: StrokePoint, point2: StrokePoint): number =>
  (point1[0] * point2[0] + point1[1] * point2[1]) / magnitude(point1) / magnitude(point2);

/** On the line through p1 and p2, `dist` beyond p2: p1, p2 and the result lie in that order. */
const extendPointOnLine = (p1: StrokePoint, p2: StrokePoint, dist: number): StrokePoint => {
  const vect = subtract(p2, p1);
  const norm = dist / magnitude(vect);
  return [p2[0] + norm * vect[0], p2[1] + norm * vect[1]];
};

/** Based on http://www.kr.tuwien.ac.at/staff/eiter/et-archive/cdtr9464.pdf */
const frechetDist = (curve1: readonly StrokePoint[], curve2: readonly StrokePoint[]): number => {
  const [longCurve, shortCurve] =
    curve1.length >= curve2.length ? [curve1, curve2] : [curve2, curve1];
  let prevResultsCol: readonly number[] = [];
  longCurve.forEach((longPoint, i) => {
    const curResultsCol: number[] = [];
    shortCurve.forEach((shortPoint, j) => {
      // Hanzi Writer's four cases: reading index -1 of a column instead is several times slower.
      const dist = distance(longPoint, shortPoint);
      if (i === 0 && j === 0) {
        curResultsCol.push(dist);
      } else if (j === 0) {
        curResultsCol.push(Math.max(prevResultsCol[0] ?? Infinity, dist));
      } else if (i === 0) {
        curResultsCol.push(Math.max(curResultsCol[j - 1] ?? Infinity, dist));
      } else {
        const reach = Math.min(
          prevResultsCol[j] ?? Infinity,
          prevResultsCol[j - 1] ?? Infinity,
          curResultsCol[j - 1] ?? Infinity,
        );
        curResultsCol.push(Math.max(reach, dist));
      }
    });
    prevResultsCol = curResultsCol;
  });
  return prevResultsCol[shortCurve.length - 1] ?? Infinity;
};

/** Breaks the segments longer than `maxLen` into equal ones. */
const subdivideCurve = (curve: readonly StrokePoint[], maxLen = 0.05): readonly StrokePoint[] => {
  const newCurve: StrokePoint[] = [];
  for (const point of curve) {
    const prevPoint = newCurve.at(-1) ?? null;
    const segLen = prevPoint === null ? 0 : distance(point, prevPoint);
    if (prevPoint === null || segLen <= maxLen) {
      newCurve.push(point);
      continue;
    }
    const numNewPoints = Math.ceil(segLen / maxLen);
    const newSegLen = segLen / numNewPoints;
    for (let i = 0; i < numNewPoints; i++) {
      newCurve.push(extendPointOnLine(point, prevPoint, -1 * newSegLen * (i + 1)));
    }
  }
  return newCurve;
};

/** Redraws the curve with `numPoints` points equally spaced along it. */
const outlineCurve = (curve: readonly StrokePoint[], numPoints = 30): readonly StrokePoint[] => {
  const curveEnds = ends(curve);
  if (curveEnds === null) return [];
  const [startPoint, endPoint] = curveEnds;
  const segmentLen = length(curve) / (numPoints - 1);
  const outlinePoints: StrokePoint[] = [startPoint];
  const remainingCurvePoints = curve.slice(1);
  let lastPoint = startPoint;
  let next = 0;
  for (let i = 0; i < numPoints - 2; i++) {
    let remainingDist = segmentLen;
    for (;;) {
      const nextPoint = remainingCurvePoints[next] ?? null;
      // Rounding only: Hanzi Writer would read past the curve's end.
      if (nextPoint === null) {
        outlinePoints.push(lastPoint);
        break;
      }
      const nextPointDist = distance(lastPoint, nextPoint);
      if (nextPointDist < remainingDist) {
        remainingDist -= nextPointDist;
        lastPoint = nextPoint;
        next += 1;
      } else {
        lastPoint = extendPointOnLine(lastPoint, nextPoint, remainingDist - nextPointDist);
        outlinePoints.push(lastPoint);
        break;
      }
    }
  }
  outlinePoints.push(endPoint);
  return outlinePoints;
};

/** Translated and scaled as in https://en.wikipedia.org/wiki/Procrustes_analysis */
const normalizeCurve = (curve: readonly StrokePoint[]): readonly StrokePoint[] => {
  const outlinedCurve = outlineCurve(curve);
  const mean: StrokePoint = [
    average(outlinedCurve.map((point) => point[0])),
    average(outlinedCurve.map((point) => point[1])),
  ];
  const translatedCurve = outlinedCurve.map((point) => subtract(point, mean));
  const translatedEnds = ends(translatedCurve);
  if (translatedEnds === null) return [];
  const scale = Math.sqrt(average(translatedEnds.map((point) => point[0] ** 2 + point[1] ** 2)));
  return subdivideCurve(
    translatedCurve.map((point): StrokePoint => [point[0] / scale, point[1] / scale]),
  );
};

/** Around the origin. */
const rotate = (curve: readonly StrokePoint[], theta: number): readonly StrokePoint[] =>
  curve.map((point): StrokePoint => [
    Math.cos(theta) * point[0] - Math.sin(theta) * point[1],
    Math.sin(theta) * point[0] + Math.cos(theta) * point[1],
  ]);

const stripDuplicates = (points: readonly StrokePoint[]): readonly StrokePoint[] =>
  points.filter((point, index) => {
    const previous = points[index - 1] ?? null;
    return previous === null || !equals(point, previous);
  });

// To the median's points, not its segments: some strokes traced exactly miss, as in Hanzi Writer.
const getAverageDistance = (
  median: readonly StrokePoint[],
  points: readonly StrokePoint[],
): number =>
  average(
    points.map((point) => Math.min(...median.map((strokePoint) => distance(strokePoint, point)))),
  );

const startAndEndMatches = (
  points: readonly StrokePoint[],
  median: readonly StrokePoint[],
  leniency: number,
): boolean => {
  const drawn = ends(points);
  const stroke = ends(median);
  if (drawn === null || stroke === null) return false;
  const threshold = START_AND_END_DIST_THRESHOLD * leniency;
  return distance(stroke[0], drawn[0]) <= threshold && distance(stroke[1], drawn[1]) <= threshold;
};

const directionMatches = (
  points: readonly StrokePoint[],
  median: readonly StrokePoint[],
): boolean => {
  const strokeVectors = getEdgeVectors(median);
  const similarities = getEdgeVectors(points).map((edgeVector) =>
    Math.max(...strokeVectors.map((strokeVector) => cosineSimilarity(strokeVector, edgeVector))),
  );
  return average(similarities) > COSINE_SIMILARITY_THRESHOLD;
};

const lengthMatches = (
  points: readonly StrokePoint[],
  median: readonly StrokePoint[],
  leniency: number,
): boolean => (leniency * (length(points) + 25)) / (length(median) + 25) >= MIN_LEN_THRESHOLD;

const shapeFit = (
  curve1: readonly StrokePoint[],
  curve2: readonly StrokePoint[],
  leniency: number,
): boolean => {
  const normCurve1 = normalizeCurve(curve1);
  const normCurve2 = normalizeCurve(curve2);
  const minDist = Math.min(
    ...SHAPE_FIT_ROTATIONS.map((theta) => frechetDist(normCurve1, rotate(normCurve2, theta))),
  );
  return minDist <= FRECHET_THRESHOLD * leniency;
};

type MatchData = {
  readonly isMatch: boolean;
  readonly avgDist: number;
  readonly isStrokeBackwards: boolean;
};

const getMatchData = (
  points: readonly StrokePoint[],
  median: readonly StrokePoint[],
  strokeNum: number,
  leniency: number,
  checkBackwards: boolean,
): MatchData => {
  const avgDist = getAverageDistance(median, points);
  const distMod = strokeNum > 0 ? 0.5 : 1;
  if (avgDist > AVERAGE_DISTANCE_THRESHOLD * distMod * leniency) {
    return { isMatch: false, avgDist, isStrokeBackwards: false };
  }
  const isMatch =
    startAndEndMatches(points, median, leniency) &&
    directionMatches(points, median) &&
    lengthMatches(points, median, leniency) &&
    shapeFit(points, median, leniency);
  const isStrokeBackwards =
    checkBackwards &&
    !isMatch &&
    getMatchData(points.toReversed(), median, strokeNum, leniency, false).isMatch;
  return { isMatch, avgDist, isStrokeBackwards };
};

const toStrokeMatch = ({ isMatch, isStrokeBackwards }: MatchData): StrokeMatch =>
  isMatch ? "match" : isStrokeBackwards ? "backwards" : "miss";

/**
 * Whether `drawn` is stroke `strokeNum` of the character. A stroke that matches a later stroke
 * better is judged again with less leniency: the learner probably drew that one.
 */
export const strokeMatches = (
  drawn: readonly StrokePoint[],
  character: StrokeData,
  strokeNum: number,
  leniency = STROKE_LENIENCY,
): Result<StrokeMatch, StrokeMatchError> => {
  const median = character.medians[strokeNum] ?? null;
  if (median === null) return err({ kind: "no-stroke", index: strokeNum });
  const points = stripDuplicates(drawn);
  if (points.length < 2) return ok("miss");

  const matchData = getMatchData(points, median, strokeNum, leniency, true);
  if (!matchData.isMatch) return ok(toStrokeMatch(matchData));

  const { avgDist } = matchData;
  let closestMatchDist = avgDist;
  for (const [offset, laterMedian] of character.medians.slice(strokeNum + 1).entries()) {
    const later = getMatchData(points, laterMedian, strokeNum + 1 + offset, leniency, false);
    if (later.isMatch && later.avgDist < closestMatchDist) closestMatchDist = later.avgDist;
  }
  if (closestMatchDist < avgDist) {
    // Between 0.3 and 0.6, depending on how much better the later stroke matches.
    const leniencyAdjustment = (0.6 * (closestMatchDist + avgDist)) / (2 * avgDist);
    return ok(
      toStrokeMatch(getMatchData(points, median, strokeNum, leniency * leniencyAdjustment, true)),
    );
  }
  return ok("match");
};
