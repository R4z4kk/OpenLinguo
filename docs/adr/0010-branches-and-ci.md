# 0010 — Branches and CI

- Status: Accepted
- Date: 2026-10-16

## Context

CI ran as one `ci` job on every pull request and again on every push to `main`. By October 2026 it took 15-20 min, 13-17 min of which were the Playwright E2E suite: 54 tests on 2 workers, about 1,240 s of WebKit and 660 s of Chromium in total (runs 38904316261 and 38913052488). Typecheck, lint, format, unit tests, build and data checks take about 2 min. Every pull request waited for the whole run, and so did the push that followed its merge.

## Decision

- Branches:
  - `main` holds released code. It only changes through a promotion pull request from `develop`, one per milestone.
  - `develop` is the default branch. Feature branches start from it and open their pull requests against it. Dependabot and the scheduled workflows follow the default branch.
  - A fix found before a promotion is merged goes to `develop`, and the open promotion pull request picks it up.
- Jobs in `.github/workflows/ci.yml`:

| Job | PR to `develop` or another branch | PR to `main` | Nightly and manual |
| --- | --- | --- | --- |
| `quick`: typecheck, lint, format, unit tests with coverage, build, data checks | runs, required | runs, required | runs |
| `e2e-shard`: Chromium in 2 shards, WebKit in 4 | skipped | runs | runs |
| `e2e`: fails unless every shard passed | skipped | runs, required | runs |

- Nothing runs on push: the pull request already tested the merge result. A nightly run (02:37 UTC) and a manual run (`workflow_dispatch`) test `develop` in full. Only pull request runs cancel the run they replace on the same branch.
- Playwright runs with `fullyParallel`, so shards split by test rather than by file.
- Rulesets:
  - `protect-main` targets `refs/heads/main` explicitly, so it does not follow the default branch. It requires a pull request, `quick` and `e2e`, merge commits only, and forbids deletion and force pushes. The branch does not have to be up to date: after a promotion, `main` holds a merge commit that `develop` lacks, and updating `develop` would need a pull request of its own.
  - `protect-develop` requires a pull request and `quick`, linear history (squash or rebase), and forbids deletion and force pushes.
- Promotions use a merge commit. `develop` stays an ancestor of `main`, so the next promotion only lists new commits. Squash or rebase would rewrite them and make the branches diverge. Merge commits take the pull request's title and description.
- Closing a milestone runs `.github/workflows/promote.yml`:
  - It opens the promotion pull request, or adds the milestone to the one already open. It does nothing when `develop` has no commit that `main` lacks.
  - It then starts `ci.yml` on `develop`. A pull request opened with `GITHUB_TOKEN` starts no `pull_request` workflow, and the run's checks land on the pull request's head commit.
  - The repository lets GitHub Actions create pull requests for this.
  - A manual run does the same without a milestone.
  - The maintainer merges: nothing merges automatically.

## Consequences

- A pull request to `develop` waits about 1 min for `quick`. A promotion waits about 5 min: 4 min 32 s for the first sharded run (run 38918133086), against 15-20 min before.
- An E2E regression merged into `develop` shows up in the nightly run or on the promotion pull request, not on the pull request that caused it.
- The shard counts are set in `ci.yml`. Change them when the WebKit to Chromium time ratio moves away from about 2.
- `main`'s first-parent history is the list of promotions.
- The repository setting that lets Actions create pull requests also lets workflows approve them. Revisit it before reviews become required (M10).
