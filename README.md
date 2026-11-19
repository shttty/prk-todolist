# prk-todolist

A todo plugin for PRK and a standard Pi extension, usable in the Pi TUI too. Core semantics come from Hermes Agent's todo tool (see `NOTICE`), with OMP-style phase layout and blocked reasons and Claude Code-style parallel work with owners.

## Features

- One direct tool: `todo_list`; no arguments reads the complete ordered list.
- Replace or merge by id; order is priority; duplicate ids use the last occurrence.
- Three levels at most: `kind: "phase"` items (title only: no status, reason or owner) → tasks (`parent` = phase id, or none) → subtasks (`parent` = task id). Deeper structures are an error and the whole write rolls back. Dangling and cyclic parents become top-level items. Without phases the list is flat, as before.
- Optional `owner` on tasks and subtasks (a worker name, one line; shown after two spaces and `·`, whitespace collapsed).
- Monotonic `revision`, atomic writes, empty-content validation, and bounded content/list size.
- `blocked` requires `reason`; leaving blocked clears the reason. Several `in_progress` items are allowed (no hard validation); with more than one, author order is kept.
- `outputSchema` and `structuredContent`; failures carrying the unchanged list return `isError`.
- `appendEntry` snapshots persist changed state outside model context and restore the current branch. Snapshots from other plugins are not read or migrated.
- Compaction injects only unfinished work (pending, in-progress, blocked) plus ancestors with unfinished descendants, with phase names, owners and blocked reasons.
- The TUI widget (`Todo closed/total`, roman-numeral phase titles with progress, finished phases folded to one line, `✓ N completed` fold, owner suffix, blocked reason on its own line) uses Pi theme tokens only. Its plain text is a contract parsed by PRK: see [`docs/widget-format.md`](docs/widget-format.md) and `tests/fixtures/widget-samples.json`.

## Why this implementation

The extension keeps Hermes' small single-tool, ordered-list contract (replace/merge by id, read with no arguments, full list back every time, reminders in the tool description, re-injection after compaction) and adds OMP's phase layout and Claude Code's parallel `in_progress` with `owner`, without OMP's nine operations. TypeScript removes the Python runtime bridge and makes state changes atomic in the host process. Pi session entries provide durable state for nested calls, branch selection, reload, and compaction.

## Usage

```json
{"todos":[{"id":"inspect","content":"Inspect the failure","status":"in_progress"}]}
```

```json
{"todos":[
  {"id":"p1","kind":"phase","content":"Build"},
  {"id":"t1","content":"Write parser","status":"in_progress","parent":"p1","owner":"worker-a"},
  {"id":"s1","content":"Edge cases","status":"pending","parent":"t1"}
]}
```

Use `merge: true` for partial updates. A blocked item must include `reason`.

## Development

```bash
npm install --include=dev
npm test
npm run check
npm pack --dry-run
```

The extension is MIT-licensed. The core is derived from Hermes Agent `tools/todo_tool.py`, commit `ea61bb9ef8`; attribution is in `NOTICE`.
