# Agent Guide

This repository contains a "lightning-fast, reference-based requirement tracing" suite.
It is supposed to work CLI based.
In the following you will be introduced to some helpful structural guidance as well as hard constraints.

First of all:
Work professionally, remember to use modern day best practises and stay focused.
Feel free to tell a user when their tasks seems unscoped or ambigious.
Ask refining questions before you start writing.

## The Repository Structure

| Folder | Purpose |
|---|---|
| src/ | Source code |
| test/ | Test code |
| docs/ | Exact Documentation ("spec-driven") - written in Markdown |
| schemas/ | Published JSON Schemas for machine-readable output formats; one file per format version, mirroring the URL it is served at |
| examples/ | Self-contained example projects; fixtures for the end-to-end tests |
| dist/ | Generated build output |
| .github/ | Continuous integration workflows and the helper scripts they run |

Keep dev dependencies to a minimum.
Keep (runtime) dependencies to zero.

## The Commands

| Cmd | Purpose |
|---|---|
| `pnpm build` | Run esbuild, bundling from 'src/' to 'dist/'. |
| `pnpm test` | Run all tests under 'test/'. |
| `pnpm run test:coverage` | Run the same tests, writing an lcov and a JUnit report to 'coverage/'. |

## Naming

Write identifiers out in full - no invented shorthand.
The only sanctioned abbreviations are listed in ABBREVIATIONS.md; use them consistently.

## Your workflow

Work in small chunks.
Commit regularly on proper (preliminary) results.
Follow conventional commits, that means use the format `<type>: <short description of work>` for every commit.
You can add a descriptive body too.
Adapt a similiar pattern for branch naming.

We are using merging over Pull Requests from feature-branches.
Every PR is being merged in as a commit; we do not squash the commits nor do we rebase anything directly on top of main without a merge commit.
Remember to have one branch focused on one change.
Suggest to split into multiple if applicable.

Commited `dist/` must match a fresh build.
Verify this with `git diff --exit-code -- dist/`.

Never bump `package.json` version manually; releases are PR-label driven per GitHub workflow and bump that automatically.

## Parallel work with git worktrees

One task = one branch = one worktree = one session.
All rules apply unchanged inside every worktree.

- Create worktrees as siblings of the main checkout: `git worktree add ..\flashtrace-wt\<branch-dir> -b <type>/<description> origin/main`
- Run `pnpm install` in a fresh worktree before building or testing; node_modules is per-worktree (pnpm's store makes this fast).
- Branch only from up-to-date `origin/main`. Never commit to `main`, and never check out or modify a branch owned by another worktree.
- Before opening a PR: `pnpm build`, `pnpm test`, then verify `git diff --exit-code -- dist/` passes.
- If `dist/` conflicts when merging main into your branch: do NOT hand-resolve. Try to rebase, then rebuild your dist.
- After your PR merges: `git worktree remove <path>` and delete the branch.
