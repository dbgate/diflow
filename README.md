# diflow

Keeps three git repositories in sync: **base + diff = merged**.

- **base** — the upstream repository (e.g. an open-source project)
- **diff** — an overlay repository holding files that are added on top of base or that override base files
- **merged** — the generated combination of the two, and the repository people actually work in

A commit landing in any one of the three is automatically propagated to the other two, so you can develop in `merged`, keep proprietary changes isolated in `diff`, and still pull upstream changes into `base`.

## Installation

```bash
npm install -g diflow
```

Or run it without installing:

```bash
npx diflow sync -r https://github.com/you/your-diflow-config.git -b master
```

## The config repository

diflow keeps no local state. Everything it needs lives in a fourth repository — the **config repo** — which you create and point diflow at. It contains two files:

### `config.json`

```json
{
  "repos": {
    "base": {
      "url": "https://github.com/you/upstream.git",
      "identifiers": [{ "name": "packages/core/**" }]
    },
    "diff": {
      "url": "https://github.com/you/overlay.git",
      "commitTag": "[skip ci]"
    },
    "merged": {
      "url": "https://github.com/you/merged.git"
    }
  },
  "ignorePaths": [".github/**"],
  "syncCommitPrefix": "SYNC:",
  "newFilesTargetDefault": "diff"
}
```

| Field | Description |
| --- | --- |
| `repos.<id>.url` | Clone URL. May contain the literal token `DIFLOW_GIT_SECRET` (see [Authentication](#authentication)). |
| `repos.<id>.commitTag` | Optional text inserted into sync commit messages for that repo, e.g. `[skip ci]`. |
| `repos.base.identifiers`, `repos.diff.identifiers` | Rules deciding where a newly added `merged` file goes. See [Identifiers](#identifiers). |
| `ignorePaths` | Glob patterns (minimatch) of files never propagated in any direction. |
| `syncCommitPrefix` | Prefix of commits created by diflow itself. Default `SYNC:`. Commits with this prefix are skipped on the next run — this is what prevents sync loops. |
| `newFilesTargetDefault` | Where new `merged` files go when no identifier matches: `base` or `diff`. Default `diff`. |

### `state.json`

Written by diflow. It records the last processed commit per repository, and is committed and pushed back to the config repo after every processed commit:

```json
{
  "base":   { "lastProcessed": "6021fa721e45ff8cf61bdd5bf71bdfcb5e69e79e" },
  "diff":   { "lastProcessed": "177a8a94e7b6b1ad240023d5f727ffc4431b4421" },
  "merged": { "lastProcessed": "9d09b197dfb456537b4412f04c37a3fa5f5ad65e" }
}
```

On the very first run, if `state.json` is absent, the current `HEAD` of each repo is taken as the starting point — existing history is not replayed.

## Usage

### `diflow sync`

```bash
diflow sync -r <config-repo-url> -b <branch> [options]
```

| Option | Description |
| --- | --- |
| `-r, --repo <url>` | **Required.** URL of the config repo. |
| `-b, --branch <name>` | **Required.** Branch to process. The same branch name is checked out in all repos. |
| `--skip-push` | Do everything locally but never push. Useful for dry runs. |
| `--clear` | Delete the working clones before starting, forcing a fresh clone. |
| `--secret <value>` | Value substituted for `DIFLOW_GIT_SECRET` in repo URLs. |

### `diflow fsmerge`

A standalone directory merge with no git involvement — copies `base` and then `diff` over an output folder:

```bash
diflow fsmerge -b ./base-dir -d ./diff-dir -m ./output-dir
```

## How synchronization works

Each run collects commits made after `lastProcessed` in all three repos, discards diflow's own sync commits, orders the rest by author timestamp, and applies them one at a time.

**Commit in `base`** — diff always wins over base:

| Change | Effect on `merged` |
| --- | --- |
| Add | Added, unless the file exists in `diff` |
| Modify | Applied, unless the file exists in `diff` |
| Delete | Deleted, unless the file exists in `diff` |
| Rename | Renamed |

**Commit in `diff`** — diff overrides:

| Change | Effect on `merged` |
| --- | --- |
| Add | Added or overwritten |
| Modify | Overwritten |
| Delete | Reverts to the `base` version if there is one, otherwise removed |
| Rename | Renamed |

**Commit in `merged`** — changes are split back into `base` and `diff`:

| Change | Effect |
| --- | --- |
| Add | Routed by [identifiers](#identifiers), defaulting to `newFilesTargetDefault` |
| Modify | Applied to `diff` if the file exists there, otherwise to `base` |
| Delete | Removed from both `base` and `diff` |
| Rename | Renamed in `diff` if the file exists there, otherwise in `base` |

## Identifiers

When a brand-new file appears in `merged`, diflow must decide whether it is an upstream file or an overlay file. Identifiers make that call:

```json
"identifiers": [
  { "name": "packages/core/**" },
  { "content": "PROPRIETARY_MARKER" }
]
```

- `name` — glob matched against the file path (minimatch)
- `content` — substring that must appear in the file's contents

Both repos' identifier lists are evaluated; if the file matches identifiers on both, **`diff` wins**. If nothing matches, `newFilesTargetDefault` decides.

## Authentication

To avoid storing credentials in the config repo, put the literal token `DIFLOW_GIT_SECRET` in the URLs:

```json
"url": "https://DIFLOW_GIT_SECRET@github.com/you/upstream.git"
```

diflow substitutes it at clone time from `--secret <value>` or from the `DIFLOW_GIT_SECRET` environment variable — handy for running syncs from CI.

## Error handling

diflow refuses to run when `lastProcessed` for a repo does not exist or is no longer an ancestor of the branch — the usual cause is a rebase or force-push. Fix the corresponding `lastProcessed` in `state.json` in the config repo and run again.

## Development

```bash
npm run build   # compile TypeScript to dist/
npm test        # build, then run the jest suite
```

Tests run against compiled output in `dist/` and create real local git repositories, so they run serially (`--runInBand`).

## License

MIT — see [LICENSE](LICENSE).
