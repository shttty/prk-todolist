# Widget text format

The widget registered as `prk-todolist.todo` is the single source of the todo display. The TUI shows it as styled lines; the PRK web UI **parses the plain text of these lines**. This document is the contract between the two: **any change to the format must be made together with the PRK parser** (`web/chat/todo-widget-parse.js` there) and the shared samples (`tests/fixtures/widget-samples.json`, copied into PRK).

Styles (bold, colours, strikethrough) carry no information that the text does not already carry. Parse the text with styles stripped; never rely on colour. Source: `src/widget.ts`.

## Whole widget

- No todo items at all: the widget is removed (no lines).
- Otherwise: one `header` line, then zero or more body lines. Every line is a single physical line.
- Lines are separated by line breaks only; there are no blank lines.

```
Todo 2/5
I. 调研  2/2
II. 实现  0/3
  ▸ 写解析器  · worker-a
    ✓ 状态行
    ○ 层级
  ! 接入浮窗
    等 Gateway 重启
  ○ 测试
```

## Line kinds

`N` and `M` are decimal integers; `SP` is one ASCII space. Texts (`name`, `content`, `owner`, `reason`) have all whitespace runs, including line breaks and tabs, collapsed to a single space and are trimmed, so none contains a line break or a double space.

| Kind | Shape | Notes |
| --- | --- | --- |
| header | `Todo` SP `closed/total` | First line. `closed` = tasks that are `completed` or `cancelled`; `total` = all tasks. Counts tasks only: not phases, not subtasks. |
| phase | `ROMAN. name` SP SP `closed/total` | No indent. `ROMAN` = 1-based position among phases, upper-case standard subtractive numerals (`I`, `IV`, `IX`, `XIV`, …). `closed/total` count the tasks of this phase only (not subtasks). |
| task | `indent symbol` SP `content` [ SP SP `·` SP `owner` ] | See indent and symbols below. |
| subtask | same shape as task | Indented two more than a task. |
| reason | `indent` `reason` | Only after a blocked item; no symbol. |
| fold | `indent` `✓` SP `N` SP `completed` | Completed-fold line; see below. |

### Symbols (task and subtask lines)

| Symbol | Status |
| --- | --- |
| `▸` | in_progress |
| `✓` | completed |
| `✕` | cancelled |
| `!` | blocked |
| `○` | pending |

### Indent

One rule per list, decided by whether the list contains **any phase**:

| | no phase in the list | at least one phase |
| --- | --- | --- |
| task | 0 spaces | 2 spaces |
| subtask | 2 spaces | 4 spaces |
| reason line | item indent + 2 | item indent + 2 |
| fold line | 0 spaces | 2 spaces |
| phase line | – | 0 spaces |

Tasks that belong to no phase are listed first, **before every phase line and without a heading** (directly after the header). When the list contains phases they use the phased indent (2 / 4) too: a task line with 2 spaces of indent before the first phase line is an unphased task.

### Order

1. header
2. unphased tasks (each task followed by its subtasks), if any
3. for each phase in list order: its phase line, then its tasks (unless the phase is folded), each task followed by its subtasks

Within a group, items keep list (author) order. A task's subtasks follow it directly, in list order.

### Owner

A task or subtask line may end with an owner. After the symbol, the **first run of two spaces** separates the content from the owner. What follows that run must be `·`, one SP, and the owner; anything else makes the whole widget unparseable. No two spaces after the symbol means no owner, and then a ` · ` inside the content (e.g. `Fix a · b`) is plain content.

This works because texts are whitespace-collapsed (see Line kinds): `content` never contains two spaces, and `owner` is collapsed too, so it never contains two spaces or a line break. The phase header uses the same convention: `name`, two spaces, `closed/total`.

Other symbols in content (`—`, `!`, `○`, `✓`, `a·b`, …) are never special.

### Blocked reason

A blocked task or subtask (`!`) is **always followed by exactly one reason line**: the very next line, indented two more than the blocked item, no symbol, the reason text only. Treat the line right after a `!` item as its reason **whatever it starts with** (a reason may begin with `✓`, `○`, digits, …). Blocked items are never folded, and subtasks of a blocked task follow the reason line.

### Completed fold

When the number of `completed` tasks (cancelled ones are not counted; subtasks are not counted) in a **scope** reaches the threshold, all completed tasks of that scope are replaced by one fold line and their subtasks are hidden:

```
✓ 3 completed
```

- Exact text: `✓` SP `N` SP `completed`, where `N` is the number of completed tasks folded (always ≥ the threshold, so ≥ 1; the default threshold is 3).
- Scope: one phase's tasks; the unphased group is its own scope; with no phases the whole list is one scope. Each scope folds independently.
- Position: where the first completed task of the scope would have been listed, in task indent (0 spaces without phases, 2 with phases). Other tasks of the scope (pending, in_progress, blocked, cancelled) keep their order and are listed normally, with their subtasks.
- Completed subtasks of tasks that are not folded are listed normally and never folded.
- Threshold: environment variable `PRK_TODOLIST_COLLAPSE_COMPLETED`, default `3`, `0` disables; a parser does not need to know it, it only sees the fold line.
- Known limitation: a completed task whose content is exactly `<N> completed` looks like a fold line (it can only appear in a scope that did not fold, so it is rare).

### Folded phase

A phase whose tasks are **all closed** (`completed` or `cancelled`, including a phase with no tasks) is output as its phase line only: no tasks, no fold line, no subtasks (even open ones). Its `closed/total` shows `N/N`.

## Parsing hints

1. Line 1 is the header. Anything else → not this format.
2. A line with no leading space is a phase line (`^[IVXLCDM]+\. (.+)  (\d+)/(\d+)$`). Split the title at the last double space.
3. A line with leading spaces starts, after the indent, with a status symbol (`▸ ✓ ✕ ! ○`) → task (indent 2 with phases, 0 without) or subtask (4 / 2); `✓ N completed` at task indent → fold line.
4. Without phases, an unindented line starting with a symbol is a task. With phases, a line before the first phase line belongs to the unphased group.
5. After a `!` item, take the next line as the reason.
6. Owner: after the symbol, split at the first run of two spaces; what follows must be `·` SP owner, else unparseable. No two-space run means no owner.
7. Any line that fits none of these → treat the whole widget as unparseable.

## Samples

`tests/fixtures/widget-samples.json` is an array of `{ name, todos, lines }`. `lines` is the exact plain-text widget for `todos` (the item list as stored by the plugin, after validation). The plugin tests assert its output line by line against it; PRK copies the file and asserts its parser against it.
