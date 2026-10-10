import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type CardInput,
  type FSRS,
  type FSRSParameters,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import { err, ok, type Result } from "./result.ts";
import type { CardState, Grade, Phase } from "./srs.ts";

export const SCHEDULER_VERSIONS = ["fsrs6-v1"] as const;

export type SchedulerVersion = (typeof SCHEDULER_VERSIONS)[number];

export const CURRENT_SCHEDULER: SchedulerVersion = "fsrs6-v1";

/**
 * Frozen copy of ts-fsrs 5.4.2 `generatorParameters()` (FSRS-6 default weights,
 * https://github.com/open-spaced-repetition/ts-fsrs). Reviews name the version they were
 * scheduled with: changed parameters are a new version, never an edit of an existing one.
 */
export const SCHEDULER_PARAMETERS: Readonly<Record<SchedulerVersion, FSRSParameters>> = {
  "fsrs6-v1": {
    request_retention: 0.9,
    maximum_interval: 36500,
    w: [
      0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
      0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ],
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  },
};

const ENGINES: Readonly<Record<SchedulerVersion, FSRS>> = {
  "fsrs6-v1": fsrs(SCHEDULER_PARAMETERS["fsrs6-v1"]),
};

const PHASE: Readonly<Record<State, Phase>> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const STATE: Readonly<Record<Phase, State>> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const RATING: Readonly<Record<Grade, FsrsGrade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export type FsrsMemory = Omit<CardState, "due" | "lastReviewDay">;

/** `interval`: milliseconds from the review to the next due time. */
export type FsrsStep = { readonly memory: FsrsMemory; readonly interval: number };

export type SchedulerFailure = { readonly kind: "scheduler-failure"; readonly message: string };

/**
 * ts-fsrs counts elapsed days between the UTC dates of `lastReview` and `now`, so callers pass
 * times on the clock whose UTC date is the day they want counted.
 */
export const fsrsNext = (
  version: SchedulerVersion,
  memory: FsrsMemory,
  lastReview: number | null,
  now: number,
  grade: Grade,
): Result<FsrsStep, SchedulerFailure> => {
  const card: CardInput = {
    ...createEmptyCard(now),
    stability: memory.stability,
    difficulty: memory.difficulty,
    scheduled_days: memory.scheduledDays,
    learning_steps: memory.learningSteps,
    reps: memory.reps,
    lapses: memory.lapses,
    state: STATE[memory.phase],
    last_review: lastReview,
  };
  try {
    const next = ENGINES[version].next(card, now, RATING[grade]).card;
    return ok({
      memory: {
        phase: PHASE[next.state],
        stability: next.stability,
        difficulty: next.difficulty,
        reps: next.reps,
        lapses: next.lapses,
        learningSteps: next.learning_steps,
        scheduledDays: next.scheduled_days,
      },
      interval: next.due.getTime() - now,
    });
  } catch (error) {
    return err({ kind: "scheduler-failure", message: String(error) });
  }
};
