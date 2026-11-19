import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const EXTENSION = fileURLToPath(new URL("../src/index.ts", import.meta.url));

test("Pi 1.2.0 loads the native todo_list extension without Python", async () => {
  assert.equal(VERSION, "1.2.0");
  const loaded = await discoverAndLoadExtensions([EXTENSION], ROOT, join(ROOT, ".pi-loader-smoke-empty"));
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0]!;
  assert.deepEqual([...extension.tools.keys()], ["todo_list"]);
  assert.equal(extension.tools.get("todo_list")?.definition.name, "todo_list");
});
