# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build            # tsc -> dist/
npm test                 # build + jest --runInBand (jest runs on compiled ./dist, never on src)
npx jest --runInBand -t "Adding new files"   # single test, AFTER npm run build
npm run test:ci          # jest with JSON reporter (used by CI)
```

Tests must be built first — `jest.config.js` sets `roots: ['./dist']`, so editing a `.ts` test without rebuilding runs stale JS. Always `--runInBand`: tests create real git repos on disk in `dist/testrepos` and `dist/workrepos` and would collide in parallel.

Manual/integration helpers:

```bash
npm run test:init        # build + create fresh local test repos (dist/testrepos)
npm run test:add         # build + commit into the test diff repo and run a sync over it
npm run test:dbgate      # dry run against the real dbgate config repo (--skip-push --clear)
```

Publishing is tag-driven: pushing a `v[0-9]+.[0-9]+.[0-9]+` tag triggers `.github/workflows` to build and `npm publish`.

## What this tool does

diflow keeps three git repositories in sync under the invariant **base + diff = merged**. `base` is an upstream/open-source repo, `diff` holds the overlay (extra or overriding files), and `merged` is the generated combination that people actually work in. A change committed to any of the three is propagated to the other two.

A fourth repo, the **config repo**, is the tool's only persistent state. It holds `config.json` (repo URLs and rules) and `state.json` (`lastProcessed` commit hash per source repo). diflow is stateless between runs — everything it needs to resume comes from the config repo, and it commits the updated `state.json` back after each processed commit.

## Architecture

- [src/diflow.ts](src/diflow.ts) — commander CLI, two commands: `sync` (the real thing) and `fsmerge` (a plain directory-level base+diff copy, no git).
- [src/processor.ts](src/processor.ts) — the whole engine. `Processor` clones/checks out the four repos into a `workrepos` dir next to the compiled output, loads state, and collects the commits to process. `CommitProcessor` applies one commit.
- [src/tools.ts](src/tools.ts) — thin git wrappers over `child_process.exec` plus file copy/remove/rename helpers.
- [src/testrepo.ts](src/testrepo.ts) — builds real local git repos for the tests; `checkStateInConfig()` is the shared assertion that state.json points at the last non-SYNC commit in each repo.

### Sync run flow

1. Clone (or reuse) config, base, diff, merged into `workrepos/`; checkout the requested branch in each.
2. Read `state.json`, and for each source repo take commits after `lastProcessed` (`getCommits` uses `--reverse --first-parent`).
3. Drop commits whose message starts with `syncCommitPrefix` (default `SYNC:`) — those are diflow's own commits, and this is the loop-prevention mechanism.
4. Merge the three commit lists into one list sorted by author timestamp, then process each in order.
5. Per commit: checkout the source commit, read its `--name-status` diff, route each changed file, commit + push the *other* repos, update `state.json`, commit + push the config repo.

### Propagation rules

Direction determines the rule; `processBaseFile` / `processDiffFile` / `processMergedFile` in [src/processor.ts](src/processor.ts) implement them.

- **base → merged**: add/modify/delete applies only if the file does **not** exist in diff (diff wins).
- **diff → merged**: add/modify always overwrite merged. Delete restores the base version if one exists, otherwise removes from merged.
- **merged → base/diff**: modify goes to diff if the file exists there, otherwise to base. Delete removes from both. Add is routed by identifiers (below), defaulting to `newFilesTargetDefault` (default `diff`).

### Identifiers

Config's `repos.base.identifiers` / `repos.diff.identifiers` decide which repo a *newly added* merged file belongs to. Each identifier matches by glob `name` (minimatch) or by substring `content`. Both lists are evaluated and **diff is checked last, so a diff match wins** over a base match.

### Guards worth preserving

- `checkLastProcessedCommit` fails the run if `lastProcessed` is missing from the repo or is not an ancestor of the branch (rebase/force-push). Better to stop than to reprocess or skip history.
- `runGitCommand` swallows failures and returns `''`; `runGitCommandChecked` throws. Anything whose result decides *what to process* must use the checked variant — an empty string there silently reads as "nothing to do".
- `ignorePaths` (minimatch, partial) is applied per changed file before routing; `.github/**` is typically excluded so CI configs don't cross repos.
- `commitTag` per repo is injected into sync commit messages (e.g. `[skip ci]`).

## Config repo format

```json
{
  "repos": {
    "base":   { "url": "...", "identifiers": [{ "name": "base-folder/**" }] },
    "diff":   { "url": "...", "commitTag": "[skip ci]" },
    "merged": { "url": "..." }
  },
  "ignorePaths": [".github/**"],
  "syncCommitPrefix": "SYNC:",
  "newFilesTargetDefault": "diff"
}
```

The shape is defined by `Config` in [src/types.ts](src/types.ts) — treat that as the source of truth. Note the checked-in `master/config/` directory is a stale clone of an older format (per-branch state, `repo1/repo2/repo3`); do not use it as a reference.

URLs may embed the literal token `DIFLOW_GIT_SECRET`, which is replaced at clone time by `--secret` or the `DIFLOW_GIT_SECRET` env var.

## Conventions

Prettier: single quotes, 120 cols, 2 spaces, `arrowParens: 'avoid'`, es5 trailing commas.
