# Changesets

1. Open PRs against `develop` with a changeset (`pnpm changeset`)
2. Run `pnpm run version` on `develop` before merging to `main` (requires `GITHUB_TOKEN`, e.g. `GITHUB_TOKEN=$(gh auth token) pnpm run version`)
3. Open a release PR: **`develop` → `main`**
4. Merge to **`main`** — CI publishes to npm (with provenance), creates git tag `vX.Y.Z`, and creates a GitHub Release from `CHANGELOG.md`

Private workspace packages (`@nanoclaw-adminapi/*`) are ignored by Changesets; only the root package is published.
