import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("Pi 1.2.0 real SessionManager persists and reloads todo snapshots by branch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "todo-real-pi-"));
  const sessionDir = join(cwd, "sessions");
  try {
    const manager = SessionManager.create(cwd, sessionDir);
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "test" }], timestamp: Date.now() });
    manager.appendCustomEntry("prk-todolist.todo-snapshot", { todos: [{ id: "old", content: "Old", status: "pending" }], revision: 1 });
    const oldLeaf = manager.getLeafId();
    assert.ok(oldLeaf);
    manager.appendCustomEntry("prk-todolist.todo-snapshot", { todos: [{ id: "new", content: "New", status: "in_progress" }], revision: 2 });
    const file = manager.getSessionFile();
    assert.ok(file);
    const text = await readFile(file, "utf8");
    assert.deepEqual(text.split("\n").filter(Boolean).map(line => JSON.parse(line).type), ["session", "message", "custom", "custom"]);

    const reopened = SessionManager.open(file, sessionDir);
    assert.equal(reopened.getBranch().at(-1)?.type, "custom");
    assert.deepEqual((reopened.getBranch().at(-1) as { data: unknown }).data, { todos: [{ id: "new", content: "New", status: "in_progress" }], revision: 2 });
    const branch = reopened.createBranchedSession(oldLeaf);
    assert.ok(branch);
    const branched = SessionManager.open(branch, sessionDir);
    const latest = branched.getBranch().at(-1);
    assert.ok(latest && "data" in latest);
    assert.deepEqual(latest.data, { todos: [{ id: "old", content: "Old", status: "pending" }], revision: 1 });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
