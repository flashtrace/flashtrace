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
| src/ | Source code (Rust) |
| tests/ | Integration tests; tests/e2e-expect/ holds the byte-exact e2e snapshots |
| docs/ | Exact Documentation ("spec-driven") - written in Markdown |
| schemas/ | Published JSON Schemas for machine-readable output formats; one file per format version, mirroring the URL it is served at |
| examples/ | Self-contained example projects; fixtures for the end-to-end tests |
| npm/ | The npm packages: the flashtrace launcher and the @flashtrace/* platform packages whose bin/ receives its binary at release time |
| .github/ | Continuous integration workflows and the helper scripts they run |

Keep dev dependencies to a minimum.
Keep runtime dependencies to the approved set: `regex`, `serde` and `serde_json` - nothing else.

## The Commands

| Cmd | Purpose |
|---|---|
| `cargo build` | Build the CLI (`target/debug/flashtrace`). |
| `cargo test` | Run all tests: per-module unit suites and the integration tests under 'tests/', including the e2e snapshot gate. |
| `cargo fmt --check` | The formatting gate CI enforces. |
| `cargo clippy --all-targets -- -D warnings` | The lint gate CI enforces. |

The e2e snapshots in tests/e2e-expect/ are generated, never hand-edited: run
`FLASHTRACE_UPDATE_SNAPSHOTS=1 cargo test --test e2e` and review the diff.

CI measures coverage with `cargo llvm-cov` and fails when a file in `src/` is
missing from the measurement, because an unmeasured file would leave the ratio
instead of lowering it (lib.rs, module declarations only, is the one exemption).

## Output contract

The CLI's observable output is a contract: docs/ and schemas/report/v0.json pin
it, and the e2e snapshots in tests/e2e-expect/ pin it byte for byte. Its text
semantics are Rust's own, and every place where text positions or orderings
reach the output follows them:

- Columns are 1-based and count characters (Unicode scalar values), never bytes
  or UTF-16 code units.
- Whitespace is Unicode `White_Space` (`str::trim`, the regex `\s`); digits in
  the ID grammar are ASCII (`[0-9]`).
- Output-visible orderings are code-point order (`str::cmp` on the string form),
  never locale-aware and never component-wise path order.
- Input files are UTF-8; a leading byte-order mark is ignored and undecodable
  bytes become U+FFFD rather than failing the run.
- Paths are handled lexically through `paths.rs` on `std::path`: relative to the
  working directory in the reports, forward slashes in the JSON document.

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

Never bump a version manually - not in `Cargo.toml`, `Cargo.lock`, the npm/
manifests, nor `CITATION.cff`; releases are PR-label driven per GitHub workflow
and bump them all automatically.

## Parallel work with git worktrees

One task = one branch = one worktree = one session.
All rules apply unchanged inside every worktree.

- Create worktrees as siblings of the main checkout: `git worktree add ..\flashtrace-wt\<branch-dir> -b <type>/<description> origin/main`
- Branch only from up-to-date `origin/main`. Never commit to `main`, and never check out or modify a branch owned by another worktree.
- Before opening a PR: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- After your PR merges: `git worktree remove <path>` and delete the branch.
