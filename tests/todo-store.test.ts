import assert from "node:assert/strict";
import test from "node:test";

import { TodoStore } from "../src/todo-store.js";

test("replace, partial merge and read return the full list with change-only revisions", () => {
  const store = new TodoStore();
  assert.deepEqual(store.invoke({}), {
    todos: [], revision: 0,
    summary: { total: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0, blocked: 0 },
  });
  const first = store.invoke({ todos: [
    { id: "a", content: "First", status: "pending" },
    { id: "b", content: "Second", status: "pending" },
  ] });
  assert.equal(first.revision, 1);
  const merged = store.invoke({ merge: true, todos: [
    { id: "a", status: "completed" },
    { id: "c", content: "Third", status: "cancelled" },
  ] });
  assert.deepEqual(merged.todos, [
    { id: "a", content: "First", status: "completed" },
    { id: "b", content: "Second", status: "pending" },
    { id: "c", content: "Third", status: "cancelled" },
  ]);
  assert.equal(merged.revision, 2);
  assert.deepEqual(store.invoke({}), merged);
  assert.equal(store.invoke({ todos: merged.todos }).revision, 2);
  assert.equal(store.invoke({ todos: [] }).revision, 3);
  assert.deepEqual(store.invoke({}).todos, []);
});

test("empty content and missing blocked reason reject the whole write, including earlier merge updates", () => {
  const store = new TodoStore();
  const original = store.invoke({ todos: [{ id: "a", content: "Keep", status: "pending" }] });
  for (const content of ["", "   "]) {
    const merged = store.invoke({ merge: true, todos: [{ id: "a", content }] });
    assert.deepEqual(merged.todos, original.todos);
    assert.equal(merged.revision, 1);
  }
  const failed = store.invoke({ merge: true, todos: [{ id: "b", content: "" }] });
  assert.match(failed.error!, /content/);
  assert.deepEqual(failed.todos, original.todos);
  assert.equal(failed.revision, 1);
  assert.match(store.invoke({ todos: [{ id: "b" }] }).error!, /content/);
  assert.match(store.invoke({ merge: true, todos: [{ id: "a", status: "blocked" }] }).error!, /reason/);
  assert.deepEqual(store.invoke({}), original);
  const blocked = store.invoke({ merge: true, todos: [{ id: "a", status: "blocked", reason: " Approval " }] });
  assert.equal(blocked.summary.blocked, 1);
  assert.equal(blocked.todos[0]?.reason, "Approval");
  assert.equal(store.invoke({ merge: true, todos: [{ id: "a", content: "Still waiting" }] }).todos[0]?.reason, "Approval");
  assert.match(store.invoke({ merge: true, todos: [{ id: "a", reason: " " }] }).error!, /reason/);
  for (const status of ["pending", "in_progress", "completed", "cancelled"] as const) {
    store.invoke({ merge: true, todos: [{ id: "a", status: "blocked", reason: "Wait" }] });
    const unblocked = store.invoke({ merge: true, todos: [{ id: "a", status }] });
    assert.equal(unblocked.todos[0]?.status, status);
    assert.equal("reason" in unblocked.todos[0]!, false);
  }
});

test("deduplicates at last occurrence, lifts a single active item, keeps author order for parallel work, and preserves nested order", () => {
  const store = new TodoStore();
  const single = store.invoke({ todos: [
    { id: "same", content: "Discard" }, { id: "done", content: "Done", status: "completed" },
    { id: "p", content: "Pending" }, { id: "same", content: "Last" },
    { id: "a", content: "Active", status: "in_progress" },
  ] });
  assert.deepEqual(single.todos.map(item => item.id), ["done", "a", "p", "same"]);
  assert.equal(single.todos[3]?.content, "Last");
  const flat = store.invoke({ todos: [
    { id: "done", content: "Done", status: "completed" }, { id: "p", content: "Pending" },
    { id: "a", content: "Active", status: "in_progress" },
    { id: "b", content: "Also active", status: "in_progress" },
  ] });
  assert.deepEqual(flat.todos.map(item => item.id), ["done", "p", "a", "b"]);
  assert.equal(flat.summary.in_progress, 2);
  const nested = store.invoke({ todos: [
    { id: "p", content: "Parent" }, { id: "c", content: "Child", parent: "p", status: "in_progress" },
  ] });
  assert.deepEqual(nested.todos.map(item => item.id), ["p", "c"]);
  assert.equal(nested.todos[1]?.parent, "p");
  const cleared = store.invoke({ merge: true, todos: [{ id: "c", parent: "" }] });
  assert.deepEqual(cleared.todos.map(item => item.id), ["c", "p"]);
  assert.equal("parent" in cleared.todos[0]!, false);
});

test("drops dangling and self parents and breaks cycles in authored order", () => {
  const store = new TodoStore();
  const value = store.invoke({ todos: [
    { id: "a", content: "A", parent: "b" }, { id: "b", content: "B", parent: "a" },
    { id: "c", content: "C", parent: "missing" }, { id: "d", content: "D", parent: "d" },
  ] });
  assert.deepEqual(value.todos, [
    { id: "a", content: "A", status: "pending" },
    { id: "b", content: "B", status: "pending", parent: "a" },
    { id: "c", content: "C", status: "pending" },
    { id: "d", content: "D", status: "pending" },
  ]);
});

test("caps Unicode content and item count, validates beyond the cap, and removes truncated parents", () => {
  const store = new TodoStore();
  const todos = Array.from({ length: 257 }, (_, i) => ({ id: String(i), content: "😀".repeat(4001) }));
  const result = store.invoke({ todos: [{ ...todos[0]!, parent: "256" }, ...todos.slice(1)] });
  assert.equal(result.todos.length, 256);
  assert.equal(result.todos.at(-1)?.id, "255");
  assert.equal([...result.todos[0]!.content].length, 4000);
  assert.ok(result.todos[0]!.content.endsWith("… [truncated]"));
  assert.equal(result.todos[0]?.parent, undefined);
  const failed = store.invoke({ todos: [...todos, { id: "bad", content: "" }] });
  assert.match(failed.error!, /content/);
  assert.equal(failed.revision, result.revision);
  assert.deepEqual(failed.todos, result.todos);
  assert.equal(store.invoke({ merge: true, todos: [{ id: "extra", content: "Overflow" }] }).revision, result.revision);
  result.todos[0]!.content = "caller mutation";
  assert.notEqual(store.invoke({}).todos[0]?.content, "caller mutation");
});

test("merge ignores explicit empty content for existing ids but rejects it for new ids", () => {
  const store = new TodoStore();
  const original = store.invoke({ todos: [{ id: "a", content: "Keep", status: "pending" }] });
  const merged = store.invoke({ merge: true, todos: [{ id: "a", content: "" }] });
  assert.deepEqual(merged.todos, original.todos);
  const failed = store.invoke({ merge: true, todos: [{ id: "new", content: "" }] });
  assert.match(failed.error!, /content/);
  assert.deepEqual(failed.todos, original.todos);
});

test("non-object items use the upstream invalid-item placeholder", () => {
  const store = new TodoStore();
  const result = store.invoke({ todos: [null, "bad", { id: "ok", content: "Okay" }] });
  assert.deepEqual(result.todos.slice(0, 2), [
    { id: "?", content: "(invalid item)", status: "pending" },
    { id: "?", content: "(invalid item)", status: "pending" },
  ]);
});

const phased = [
  { id: "p1", kind: "phase", content: "Research" },
  { id: "t1", content: "Read code", parent: "p1", status: "in_progress", owner: "worker-a" },
  { id: "s1", content: "Parser", parent: "t1" },
  { id: "loose", content: "Unphased" },
];

test("phases are title-only items; tasks nest phase → task → subtask and summary counts tasks", () => {
  const store = new TodoStore();
  const result = store.invoke({ todos: phased });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.todos, [
    { id: "p1", kind: "phase", content: "Research" },
    { id: "t1", content: "Read code", status: "in_progress", parent: "p1", owner: "worker-a" },
    { id: "s1", content: "Parser", status: "pending", parent: "t1" },
    { id: "loose", content: "Unphased", status: "pending" },
  ]);
  assert.deepEqual(result.summary, { total: 3, pending: 2, in_progress: 1, completed: 0, cancelled: 0, blocked: 0 });
  const renamed = store.invoke({ merge: true, todos: [{ id: "p1", content: "Investigation" }] });
  assert.deepEqual(renamed.todos[0], { id: "p1", kind: "phase", content: "Investigation" });
});

test("phases reject status, parent, reason, owner and unknown kinds with whole-write rollback", () => {
  const store = new TodoStore();
  const original = store.invoke({ todos: phased });
  for (const extra of [{ status: "pending" }, { parent: "t1" }, { reason: "x" }, { owner: "w" }]) {
    const [key] = Object.keys(extra);
    const failed = store.invoke({ todos: [{ id: "new", content: "Fresh" }, { id: "p2", kind: "phase", content: "Bad", ...extra }] });
    assert.match(failed.error!, new RegExp(`Phase 'p2' must not have ${key}`));
    assert.deepEqual(failed.todos, original.todos);
    assert.equal(failed.revision, original.revision);
  }
  assert.match(store.invoke({ merge: true, todos: [{ id: "p1", status: "completed" }] }).error!, /must not have status/);
  assert.match(store.invoke({ merge: true, todos: [{ id: "t1", kind: "phase" }] }).error!, /must not have (status|parent|owner)/);
  assert.match(store.invoke({ todos: [{ id: "x", kind: "group", content: "Nope" }] }).error!, /invalid kind/);
  assert.deepEqual(store.invoke({}), original);
  assert.equal(store.invoke({ todos: [{ id: "p", kind: "phase", content: "Ok", status: "", parent: " " }] }).error, undefined);
});

test("more than three levels is an error and rolls the whole write back", () => {
  const store = new TodoStore();
  const original = store.invoke({ todos: phased });
  const tooDeep = store.invoke({ merge: true, todos: [{ id: "extra", content: "Fine" }, { id: "ss", content: "Sub-subtask", parent: "s1" }] });
  assert.match(tooDeep.error!, /nested too deeply.*'ss'|'ss'.*nested too deeply/);
  assert.deepEqual(tooDeep.todos, original.todos);
  assert.equal(tooDeep.revision, original.revision);
  // Re-parenting a task that already has subtasks under another task would make its children third-level+1.
  assert.match(store.invoke({ merge: true, todos: [{ id: "t2", content: "Second", parent: "p1" }, { id: "t1", parent: "t2" }] }).error!, /nested too deeply/);
  // Without phases the limit is task → subtask → (nothing).
  const flat = new TodoStore();
  assert.match(flat.invoke({ todos: [{ id: "a", content: "A" }, { id: "b", content: "B", parent: "a" }, { id: "c", content: "C", parent: "b" }] }).error!, /nested too deeply/);
  assert.equal(flat.invoke({ todos: [{ id: "a", content: "A" }, { id: "b", content: "B", parent: "a" }] }).error, undefined);
});

test("owner is optional, trimmed, merge-preserved and clearable; any text is accepted (collapsed when rendered)", () => {
  const store = new TodoStore();
  const first = store.invoke({ todos: [{ id: "a", content: "A", owner: "  worker a " }, { id: "b", content: "B" }] });
  assert.equal(first.todos[0]?.owner, "worker a");
  assert.equal("owner" in first.todos[1]!, false);
  assert.equal(store.invoke({ merge: true, todos: [{ id: "a", status: "in_progress" }] }).todos[0]?.owner, "worker a");
  assert.equal("owner" in store.invoke({ merge: true, todos: [{ id: "a", owner: "" }] }).todos[0]!, false);
  const withSeparator = store.invoke({ merge: true, todos: [{ id: "b", owner: "x · y" }] });
  assert.equal(withSeparator.error, undefined);
  assert.equal(store.invoke({ merge: true, todos: [{ id: "b", owner: "x\ny" }] }).todos[1]?.owner, "x\ny");
});
