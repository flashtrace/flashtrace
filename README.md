# badges

This is an orphan branch. It shares no history with `main`, holds no source
code, and is never merged anywhere.

It exists to carry the numbers behind two badges in the README's Quality
Summary:

| File | Badge |
|---|---|
| `coverage.json` | Line coverage of `src/`, measured by `node --test`. |
| `tests.json` | Number of tests run by `node --test`. |

Both are [shields.io endpoint](https://shields.io/badges/endpoint-badge)
documents. The README points shields.io at their `raw.githubusercontent.com`
URLs on this branch.

The CI workflow rewrites them on every push to `main`, from the reports that
`pnpm run test:coverage` produces. Editing them by hand only lasts until the
next push to `main`, so change `.github/scripts/quality-badges.mjs` on `main`
instead.

Do not delete this branch: the badges stop resolving the moment it is gone.
