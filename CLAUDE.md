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
| dist/ | Generated build output |
| .github/ | Continuous integration workflows |

Keep dev dependencies to a minimum.
Keep (runtime) dependencies to zero.

## The Commands

| Cmd | Purpose |
|---|---|
| `pnpm build` | Run esbuild, bundling from 'src/' to 'dist/'. |
| `pnpm test` | Run all tests under 'test/'. |

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
