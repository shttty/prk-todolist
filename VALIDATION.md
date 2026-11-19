# prk-todolist validation record

## 2026-11-19 prk-todolist cutover

- `npm test`: 24 passed, 0 failed, 0 skipped, including the real Pi loader and SessionManager tests.
- `npm run check`: passed.
- Package metadata, widget key, snapshot and injection identifiers now use prk-todolist; the only collapse environment variable is `PRK_TODOLIST_COLLAPSE_COMPLETED`.
- Removed the legacy tool-result snapshot schema and recovery branch. The mixed legacy/failure test now covers failed writes using a native snapshot; rollback assertions remain.
- The core and its two-line MIT attribution header are unchanged. Other plugins' session snapshots are not read or migrated.
- Source scan for the old package/identifier prefix (excluding dependencies and Git internals): no matches.


## 2026-10-22 phases, owner and widget text contract (`feat/phases`)

- `env -u NODE_ENV npm run check`: passed.
- `env -u NODE_ENV npm test`: 24 passed, 0 failed.
- Covered: three-level validation and whole-write rollback, phases without status/parent/reason/owner, owner rules, several in_progress with author order kept, old snapshots restore (no `kind`), too-deep old snapshots skipped, tool description reminders, compaction injection (unfinished items, ancestors, phase names, owner, blocked reason), widget output asserted line by line against `tests/fixtures/widget-samples.json`, fold threshold env, semantic theme tokens.
- Not run here: PRK parsing of the widget text and live Gateway/compaction verification (done by the PRK side). No service touched.
- Supersedes the 2026-10-14 notes below where they mention the old `Todo (n/m)` widget text, one `in_progress` guidance, and ` — reason` on the item line.

## 2026-10-14

## Automated checks

- `node --import tsx --test tests/todo-extension.test.ts tests/todo-store.test.ts`: 10 passed.
- Covered replace, merge, read, revision, atomic rollback, blocked reason, parent sanitization, in-progress ordering, bounds, appendEntry restore, compaction, widget nesting, and renderers. Legacy tool-result recovery covered at that time was removed in the prk-todolist cutover.
- Initial validation: `npm run check` was blocked by `tests/pi-loader-smoke.test.ts` context typing and renderer declaration typing; native runtime tests passed. The current check result is recorded below.
- Pluralization fix: `npm run check`, `npm test` (14 passed), and `git diff --check` passed. The existing renderer test and a direct renderer smoke cover Write, Merge, and No changes for 0, 1, and 2 items; only 1 uses `item`. No live service was touched.

## Observed output

```text
renderCall: 写入 1 项
renderResult collapsed: 更新 ! Changed — Approval
widget: Todo (0/2), ○ Parent,   ! Child — Approval
```

## Scope and provenance

Python bridge, vendor snapshot, and Python tests were removed. TypeScript TodoStore is derived from Hermes `tools/todo_tool.py`, commit `ea61bb9ef8`; OMP contributes only blocked semantics. No PRK live verification was run: this worktree was intentionally isolated and no service or real PRK home was touched.

## Remaining risk

The initial loader smoke and full typecheck findings are resolved: the current checks pass. No paid model, push, tag, version change, PRK configuration change, or service restart was performed.
