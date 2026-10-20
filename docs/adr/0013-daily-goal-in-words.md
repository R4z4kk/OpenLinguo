# 0013 — Daily goal in words

- Status: Accepted
- Date: 2026-10-20 (#209)
- Amends the M2 daily goal (#79, #80, epic #30): words done instead of reviews

## Context

In M2 the daily goal is a number of reviews per learning day (#79). Each review stamps the goal in effect (`dailyGoal`), and a streak day is a learning day whose goal was met, so the streak derives from the log alone (#80). XP is 10 per review.

The maintainer's M5 manual run (2026-10-20) found two problems. The FSRS learning steps `["1m", "10m"]` (`packages/core/src/fsrs.ts`) bring a new card back about 10 minutes after its first grade. The review page appended it to the queue and showed `done + queue.length`, so « 20 sur 20 » became « 20 sur 21 ». Each pass also counted toward the goal, so 20 new words made 40 reviews.

`composeSession` already shows one card per word (a reading or a note) per learning day. A session's items are therefore its words.

ts-fsrs 5.4.2, frozen as `fsrs6-v1`, handles a review before the due date (`dist/index.mjs`). `reviewState` computes retrievability from the days actually elapsed (`forgetting_curve(elapsed_days, stability)`), so an early review gains less stability. `next_state` uses the short-term stability when no day has elapsed.

## Decision

All choices below are the maintainer's, 2026-10-20.

- **A word is done for the day** when its card is next due on a later learning day, that is, when the card leaves today's queue.
- **The log records it.** Each review stamps `wordDone`, computed from the card's state after the grade. Reviews logged before this decision, and the history imported from Anki, have `null` and count one each, as before. Past days keep the count their goal was met with, and no streak day is lost. A Dexie upgrade sets `null` on stored reviews, and a backup without the field reads it as `null`.
- **Daily goal: words done** per learning day, with the same presets (10, 20, 50, 100, default 20). The streak, goal days and the heatmap's « goal met » shade follow it. A word done twice on one day counts once.
- **Unchanged**: XP stays 10 per review, and the stats keep counting reviews (reviews per studied day, heatmap « reviews » shade). The review that empties the session caps the stamped goal at the day's words, so a day with nothing left to review is still met.
- **Session bar**: « X sur N mots ». N is the number of words the session was composed with, and X is the words done. A card that comes back does not change N. The end reads « Séance terminée : N mots ».
- **« Commencer la séance de demain »** at the end of a session, the normal one only. It composes the session with `ahead`: cards due by the end of tomorrow, and new cards up to twice the daily limit minus those started today, which is tomorrow's quota now. Tomorrow keeps its own quota, because the limit counts the cards started on that day. One card per word per learning day still holds on the real day: a word seen today waits for tomorrow.
- **Same log, same values** (#80) still holds: the done flag is in the log.

## Consequences

- The review log gains a field, which the server (M8) reads as stored. Its schema stays append-only.
- On the day of the upgrade, reviews logged before it and words done after it add up toward the same goal.
- Reviewing ahead gives slightly shorter intervals than waiting, as FSRS credits an early review less. The learner chooses it, and the button says what it does.
- Profile's setting reads « Objectif du jour (mots) ». « Nouvelles cartes par jour » stays a number of cards.
