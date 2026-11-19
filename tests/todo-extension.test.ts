import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.js";
import type { TodoResult } from "../src/todo-store.js";
import { todoLines } from "../src/widget.js";
import samples from "./fixtures/widget-samples.json" with { type: "json" };

async function harness(branch: unknown[] = []) {
  let tool!: ToolDefinition;
  const handlers = new Map<string, Function>();
  const widgets: unknown[] = [], sent: Array<{ content: string }> = [];
  const ctx = { mode: "tui", ui: { theme: { fg: (_: string, s: string) => s, bold: (s: string) => s, strikethrough: (s: string) => s }, setWidget: (_: string, lines: unknown) => widgets.push(lines) }, sessionManager: { getBranch: () => branch, getSessionId: () => "test" } } as unknown as ExtensionToolContext;
  await extension({ registerTool: (t: ToolDefinition) => { tool = t; }, on: (name: string, fn: Function) => handlers.set(name, fn), appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }), sendMessage: (m: { content: string }) => sent.push(m) } as unknown as ExtensionAPI);
  return { tool, branch, widgets, sent, ctx, emit: (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx), call: (args: unknown = {}) => tool.execute("test", args, undefined, undefined, ctx) };
}

test("changed nested calls persist without toolResult, reload and selected branches restore", async () => {
  const h = await harness();
  assert.equal(h.tool.name, "todo_list");
  const written = await h.call({ todos: [{ id: "a", content: "Keep", status: "pending" }] });
  assert.ok(h.tool.outputSchema);
  assert.equal(written.content[0]?.type, "text");
  if (written.content[0]?.type === "text") assert.deepEqual(JSON.parse(written.content[0].text), written.structuredContent);
  assert.equal(h.branch.length, 1);
  await h.call();
  assert.equal(h.branch.length, 1);
  const resumed = await harness(h.branch);
  await resumed.emit("session_start");
  assert.deepEqual((await resumed.call()).structuredContent, written.structuredContent);
  resumed.branch.splice(0);
  await resumed.emit("session_tree");
  assert.deepEqual((await resumed.call()).structuredContent, { todos: [], revision: 0, summary: { total: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0, blocked: 0 } });
});

test("failures return data without persisting", async () => {
  const h = await harness();
  await h.call({ todos: [{ id: "a", content: "Keep", status: "pending" }] });
  const before = await h.call();
  const failed = await h.call({ merge: true, todos: [{ id: "a", status: "blocked" }] });
  assert.equal(failed.isError, true);
  assert.deepEqual((failed.structuredContent as TodoResult).todos, (before.structuredContent as TodoResult).todos);
  assert.equal(h.branch.length, 1);
});

export { harness };

test("compaction retains active descendants and their completed ancestors, includes blocked reason, deduplicates", async () => {
  const h = await harness();
  await h.call({ todos: [
    { id: "p", content: "Parent", status: "completed" },
    { id: "c", content: "Child", status: "blocked", reason: "Approval", parent: "p" },
    { id: "d", content: "Finished", status: "completed" },
  ] });
  const event = { compactionEntry: { id: "compact" } };
  await h.emit("session_compact", event);
  await h.emit("session_compact", event);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0]!.content, /Parent/);
  assert.match(h.sent[0]!.content, /  - \[!\] c\. Child.*Approval/);
  assert.doesNotMatch(h.sent[0]!.content, /Finished/);
});

test("widget nests blocked children and clears on empty replacement", async () => {
  const h = await harness();
  await h.call({ todos: [{ id: "p", content: "Parent" }, { id: "c", content: "Child", parent: "p", status: "blocked", reason: "Approval" }] });
  assert.deepEqual(h.widgets.at(-1), ["Todo 0/1", "○ Parent", "  ! Child", "    Approval"]);
  await h.call({ todos: [] });
  assert.equal(h.widgets.at(-1), undefined);
});

test("renderers summarize calls, show only changes collapsed and all items expanded", async () => {
  const h = await harness();
  assert.ok(h.tool.renderCall);
  assert.ok(h.tool.renderResult);
  const context = {} as Parameters<NonNullable<typeof h.tool.renderCall>>[2];
  for (const count of [0, 1, 2]) {
    const todos = Array.from({ length: count }, (_, i) => ({ id: String(i), content: `Task ${i}` }));
    const noun = count === 1 ? "item" : "items";
    assert.equal(h.tool.renderCall({ todos }, h.ctx.ui.theme, context).render(100).join("\n").trimEnd(), `Write ${count} ${noun}`);
    assert.equal(h.tool.renderCall({ todos, merge: true }, h.ctx.ui.theme, context).render(100).join("\n").trimEnd(), `Merge ${count} ${noun}`);
    await h.call({ todos });
    const unchanged = await h.call();
    assert.equal(h.tool.renderResult(unchanged, { expanded: false, isPartial: false }, h.ctx.ui.theme, context).render(100).join("\n").trimEnd(), `No changes · ${count} ${noun}`);
  }
  await h.call({ todos: [{ id: "a", content: "Changed" }, { id: "b", content: "Unchanged" }] });
  const result = await h.call({ merge: true, todos: [{ id: "a", status: "blocked", reason: "Approval" }] });
  const collapsed = h.tool.renderResult(result, { expanded: false, isPartial: false }, h.ctx.ui.theme, context).render(100).join("\n");
  assert.match(collapsed, /updated ! Changed\s*\n\s+Approval/);
  assert.doesNotMatch(collapsed, /Unchanged/);
  assert.match(h.tool.renderResult(result, { expanded: true, isPartial: false }, h.ctx.ui.theme, context).render(100).join("\n"), /Unchanged/);
});

test("snapshots without kind restore; a snapshot nested beyond three levels is skipped as bad", async () => {
  const snap = (todos: unknown[], revision: number) => ({ type: "custom", customType: "prk-todolist.todo-snapshot", data: { todos, revision } });
  const good = snap([{ id: "a", content: "A", status: "pending" }, { id: "b", content: "B", status: "pending", parent: "a" }], 1);
  const deep = snap([...(good.data.todos), { id: "c", content: "C", status: "pending", parent: "b" }], 2);
  const restored = await harness([good]);
  assert.deepEqual((await restored.call()).structuredContent, { todos: good.data.todos, revision: 1, summary: { total: 2, pending: 2, in_progress: 0, completed: 0, cancelled: 0, blocked: 0 } });
  const skipped = await harness([good, deep]);
  assert.equal(((await skipped.call()).structuredContent as unknown as TodoResult).todos.length, 2);
  const none = await harness([deep]);
  assert.deepEqual(((await none.call()).structuredContent as unknown as TodoResult).todos, []);
  const phased = snap([{ id: "p", kind: "phase", content: "Phase" }, { id: "t", content: "Task", status: "pending", parent: "p" }], 3);
  assert.equal(((await (await harness([phased])).call()).structuredContent as unknown as TodoResult).todos[0]?.kind, "phase");
});

test("compaction injects only unfinished items with ancestors, phase names, owner and blocked reason", async () => {
  const h = await harness();
  await h.call({ todos: [
    { id: "p1", kind: "phase", content: "Done phase" },
    { id: "d1", content: "Closed task", status: "completed", parent: "p1" },
    { id: "p2", kind: "phase", content: "Build phase" },
    { id: "t1", content: "Parser", status: "completed", parent: "p2" },
    { id: "s1", content: "Edge cases", status: "in_progress", parent: "t1", owner: "worker-a" },
    { id: "s2", content: "Closed sub", status: "cancelled", parent: "t1" },
    { id: "t2", content: "Wire widget", status: "blocked", reason: "Gateway restart", parent: "p2", owner: "worker-b" },
    { id: "t3", content: "Docs", parent: "p2" },
  ] });
  await h.emit("session_compact", { compactionEntry: { id: "c" } });
  assert.deepEqual(h.sent[0]!.content.split("\n").slice(1), [
    "- [phase] p2. Build phase",
    "  - [x] t1. Parser (completed)",
    "    - [>] s1. Edge cases (in_progress, owner: worker-a)",
    "  - [!] t2. Wire widget (blocked, owner: worker-b) — Gateway restart",
    "  - [ ] t3. Docs (pending)",
  ]);
});

test("tool description keeps the Hermes reminders and states concurrency, structure and blocked rules", async () => {
  const { tool } = await harness();
  for (const phrase of ["3+ steps", "all N items", "Call with no parameters", "List order is priority", "never based on intent", "cancel it and add a revised item", "full current list", "parallel", "owner", "three levels", "kind \"phase\"", "blocked requires reason"]) assert.ok(tool.description.includes(phrase), phrase);
  assert.doesNotMatch(tool.description, /ONE item in_progress/);
  assert.ok(tool.description.length < 1100);
});

test("widget text matches the shared samples line by line (styles stripped)", async () => {
  for (const sample of samples) {
    const h = await harness();
    const written = await h.call({ todos: sample.todos });
    assert.equal((written.structuredContent as unknown as TodoResult).error, undefined, sample.name);
    assert.deepEqual(h.widgets.at(-1), sample.lines, sample.name);
  }
});

test("completed folding follows PRK_TODOLIST_COLLAPSE_COMPLETED and phase folding can be disabled for the expanded view", async () => {
  const todos = [1, 2, 3].map(n => ({ id: `c${n}`, content: `Done ${n}`, status: "completed" as const }));
  const theme = (await harness()).ctx.ui.theme;
  const previous = process.env.PRK_TODOLIST_COLLAPSE_COMPLETED;
  try {
    for (const [value, lines] of [["0", ["Todo 3/3", "✓ Done 1", "✓ Done 2", "✓ Done 3"]], ["2", ["Todo 3/3", "✓ 3 completed"]], ["4", ["Todo 3/3", "✓ Done 1", "✓ Done 2", "✓ Done 3"]], [" 3 ", ["Todo 3/3", "✓ 3 completed"]]] as const) {
      process.env.PRK_TODOLIST_COLLAPSE_COMPLETED = value;
      assert.deepEqual(todoLines(theme, todos), lines, value);
    }
    process.env.PRK_TODOLIST_COLLAPSE_COMPLETED = "2";
    assert.deepEqual(todoLines(theme, todos, false), ["Todo 3/3", "✓ Done 1", "✓ Done 2", "✓ Done 3"]);
    const phased = [{ id: "p", kind: "phase" as const, content: "P" }, ...todos.map(t => ({ ...t, parent: "p" }))];
    assert.deepEqual(todoLines(theme, phased), ["Todo 3/3", "I. P  3/3"]);
    assert.deepEqual(todoLines(theme, phased, false).slice(1), ["I. P  3/3", "  ✓ Done 1", "  ✓ Done 2", "  ✓ Done 3"]);
  } finally {
    if (previous === undefined) delete process.env.PRK_TODOLIST_COLLAPSE_COMPLETED; else process.env.PRK_TODOLIST_COLLAPSE_COMPLETED = previous;
  }
});

test("widget uses only theme semantic colours and attributes", async () => {
  const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => `*${text}*`, strikethrough: (text: string) => `~${text}~` } as unknown as Parameters<typeof todoLines>[0];
  const lines = todoLines(theme, [
    { id: "p1", kind: "phase", content: "Active" }, { id: "p2", kind: "phase", content: "Idle" },
    { id: "a", content: "Run", status: "in_progress", parent: "p1", owner: "w" },
    { id: "b", content: "Wait", status: "blocked", parent: "p1", reason: "Why" },
    { id: "c", content: "Todo", status: "pending", parent: "p2" },
    { id: "d", content: "Gone", status: "cancelled", parent: "p2" },
    { id: "e", content: "Done", status: "completed", parent: "p2" },
  ]);
  assert.deepEqual(lines, [
    "*Todo*" + " <dim>2/5</dim>",
    "<accent>*I. Active*</accent>  <dim>0/2</dim>",
    "  <accent>*▸ Run*</accent><dim>  · w</dim>",
    "  <warning>! Wait</warning>",
    "    <warning>Why</warning>",
    "<dim>*II. Idle*</dim>  <dim>2/3</dim>",
    "  <muted>○ Todo</muted>",
    "  <dim>✕ ~Gone~</dim>",
    "  <dim>✓ Done</dim>",
  ]);
});
