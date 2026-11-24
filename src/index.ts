import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Array as TArray, Object as TObject, String as TString, Number as TNumber, Boolean as TBoolean, Optional, Union, Literal } from "typebox";
import { Check } from "typebox/value";
import { TodoStore } from "./todo-store.js";
import type { TodoItem } from "./todo-store.js";
import { changeLines, todoLines } from "./widget.js";
import { Text } from "@earendil-works/pi-tui";

const SNAPSHOT = "prk-todolist.todo-snapshot";
const Status = Union([Literal("pending"), Literal("in_progress"), Literal("completed"), Literal("cancelled"), Literal("blocked")]);
const Item = Union([
  TObject({ id: TString(), kind: Literal("phase"), content: TString() }),
  TObject({ id: TString(), content: TString(), status: Status, parent: Optional(TString()), reason: Optional(TString()), owner: Optional(TString()) }),
]);
const State = TObject({ todos: TArray(Item), revision: TNumber() });
const Summary = TObject({ total: TNumber(), pending: TNumber(), in_progress: TNumber(), completed: TNumber(), cancelled: TNumber(), blocked: TNumber() });
const Output = TObject({ todos: TArray(Item), revision: TNumber(), summary: Summary, error: Optional(TString()) });


function itemCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function hierarchy(todos: readonly TodoItem[]): Array<{ item: TodoItem; depth: number }> {
  const children = new Map<string | undefined, TodoItem[]>();
  for (const item of todos) children.set(item.parent, [...(children.get(item.parent) ?? []), item]);
  const result: Array<{ item: TodoItem; depth: number }> = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const item of children.get(parent) ?? []) { result.push({ item, depth }); visit(item.id, depth + 1); }
  };
  visit(undefined, 0);
  return result;
}

function widget(ctx: ExtensionContext, todos: TodoItem[]): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setWidget("prk-todolist.todo", todos.length ? todoLines(ctx.ui.theme, todos) : undefined);
}
function restore(ctx: ExtensionContext): TodoStore {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]!;
    let state: { todos: TodoItem[]; revision: number } | undefined;
    if (entry.type === "custom" && entry.customType === SNAPSHOT && Check(State, entry.data)) state = entry.data;
    if (state) {
      try { return new TodoStore(state.todos, state.revision); } catch { /* Ignore malformed historical snapshots. */ }
    }
  }
  return new TodoStore();
}

export default function todoExtension(pi: ExtensionAPI): void {
  const stores = new Map<string, TodoStore>();
  const current = (ctx: ExtensionContext) => {
    const id = ctx.sessionManager.getSessionId();
    let store = stores.get(id);
    if (!store) { store = restore(ctx); stores.set(id, store); }
    return store;
  };
  pi.registerTool({
    name: "todo_list", label: "Todo",
    description: "Track todos for 3+ steps (enumerate all N items; Call with no parameters to read; returns full current list). " +
      "List order is priority; max three levels: kind \"phase\" -> task -> subtask. " +
      "One in_progress unless parallel with owner; blocked requires reason; complete only when verified, never based on intent; if failed, cancel it and add a revised item.",
    parameters: TObject({ todos: Optional(TArray(TObject({
      id: TString(),
      content: Optional(TString()),
      kind: Optional(Literal("phase")),
      status: Optional(Status),
      parent: Optional(TString()),
      reason: Optional(TString()),
      owner: Optional(TString()),
    }))), merge: Optional(TBoolean()) }),
    outputSchema: Output,
    executionMode: "sequential",
    renderCall(args, theme) {
      return new Text(theme.bold(args.todos ? `${args.merge ? "Merge" : "Write"} ${itemCount(args.todos.length)}` : "Read"), 0, 0);
    },
    renderResult(response, options, theme) {
      const details = response.details;
      if (!Check(TObject({ result: Output, before: TArray(Item) }), details)) return new Text("", 0, 0);
      const { result, before } = details;
      const lines: string[] = [];
      if (result.error) lines.push(theme.fg("error", result.error));
      if (options.expanded) {
        if (result.todos.length) lines.push(...todoLines(theme, result.todos, false));
      } else {
        const old = new Map(before.map(item => [item.id, item]));
        for (const item of result.todos) {
          const previous = old.get(item.id);
          if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) {
            const [first, ...rest] = changeLines(theme, item, result.todos);
            lines.push(`${previous ? "updated" : "added"} ${first}`, ...rest);
          }
          old.delete(item.id);
        }
        for (const item of old.values()) lines.push(theme.fg("dim", `removed ${item.content}`));
      }
      return new Text(lines.join("\n") || `No changes · ${itemCount(result.todos.length)}`, 0, 0);
    },
    async execute(_id, args, _signal, _update, ctx) {
      const store = current(ctx);
      const before = store.invoke({});
      const result = store.invoke(args);
      if (result.revision !== before.revision) pi.appendEntry(SNAPSHOT, { todos: result.todos, revision: result.revision });
      widget(ctx, result.todos);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, details: { result, before: before.todos }, isError: result.error !== undefined };
    },
  });
  const onRestore = (_event: unknown, ctx: ExtensionContext) => {
    const store = restore(ctx);
    stores.set(ctx.sessionManager.getSessionId(), store);
    widget(ctx, store.invoke({}).todos);
  };
  pi.on("session_start", onRestore);
  pi.on("session_tree", onRestore);
  const injected = new Set<string>();
  pi.on("session_compact", (event, ctx) => {
    const key = `${ctx.sessionManager.getSessionId()}:${event.compactionEntry.id}`;
    if (injected.has(key) || ctx.sessionManager.getBranch().some(entry => entry.type === "custom_message" && entry.customType === SNAPSHOT && typeof entry.details === "object" && entry.details !== null && "sourceCompactionEntryId" in entry.details && entry.details.sourceCompactionEntryId === event.compactionEntry.id)) return;
    const todos = current(ctx).invoke({}).todos;
    const byId = new Map(todos.map(item => [item.id, item]));
    const keep = new Set<string>();
    for (const item of todos) {
      if (item.kind === "phase" || item.status === "completed" || item.status === "cancelled") continue;
      let node: TodoItem | undefined = item;
      while (node && !keep.has(node.id)) { keep.add(node.id); node = node.parent ? byId.get(node.parent) : undefined; }
    }
    const markers = { pending: "[ ]", in_progress: "[>]", completed: "[x]", cancelled: "[~]", blocked: "[!]" };
    const lines = hierarchy(todos).filter(({ item }) => keep.has(item.id)).map(({ item, depth }) => "  ".repeat(depth) + (item.kind === "phase" ? `- [phase] ${item.id}. ${item.content}`
      : `- ${markers[item.status]} ${item.id}. ${item.content} (${item.status}${item.owner ? `, owner: ${item.owner}` : ""})${item.reason ? ` — ${item.reason}` : ""}`));
    if (lines.length) pi.sendMessage({ customType: SNAPSHOT, display: false, content: ["[Your active task list was preserved across context compression]", ...lines].join("\n"), details: { type: "prk-todolist.todo-injection", version: 1, sourceCompactionEntryId: event.compactionEntry.id } }, { triggerTurn: false });
    injected.add(key);
  });
}
