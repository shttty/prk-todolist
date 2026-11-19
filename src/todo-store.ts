// Derived from NousResearch/hermes-agent tools/todo_tool.py, ea61bb9ef8 (MIT).
// Copyright (c) 2025 Nous Research. Full upstream license: NOTICE.
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
// A phase is a title only: no status, parent, reason or owner. Tasks (phase → task → subtask) carry the rest.
export type PhaseItem = {
  id: string;
  kind: "phase";
  content: string;
  status?: never;
  parent?: never;
  reason?: never;
  owner?: never;
};
export type TaskItem = {
  id: string;
  kind?: never;
  content: string;
  status: TodoStatus;
  parent?: string;
  reason?: string;
  owner?: string;
};
export type TodoItem = PhaseItem | TaskItem;
export type TodoArguments = {
  todos?: unknown[];
  merge?: boolean;
};
export type TodoResult = {
  todos: TodoItem[];
  revision: number;
  summary: Record<TodoStatus | "total", number>;
  error?: string;
};

export class TodoStore {
  private items: TodoItem[] = [];
  private revision = 0;
  constructor(todos: TodoItem[] = [], revision = 0) {
    this.items = writeItems([], todos, false);
    this.revision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }
  invoke(args: TodoArguments): TodoResult {
    if (args.todos !== undefined) {
      try {
        const next = writeItems(this.items, args.todos, args.merge ?? false);
        if (!sameItems(next, this.items)) {
          this.items = next;
          this.revision += 1;
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return { ...this.invoke({}), error: error.message };
      }
    }
    const summary = { total: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0, blocked: 0 };
    for (const item of this.items) if (item.kind !== "phase") { summary.total += 1; summary[item.status] += 1; }
    return { todos: this.items.map(item => ({ ...item })), revision: this.revision, summary };
  }
}

const STATUSES: Record<string, true | undefined> = { pending: true, in_progress: true, completed: true, cancelled: true, blocked: true };
const MAX_ITEMS = 256;
const MAX_CONTENT = 4000;
const TRUNCATION_MARKER = "… [truncated]";

function capContent(value: string): string {
  if (value.length <= MAX_CONTENT) return value;
  // Python's len/slice count Unicode code points, not UTF-16 code units.
  const chars = [...value];
  return chars.length > MAX_CONTENT
    ? chars.slice(0, MAX_CONTENT - TRUNCATION_MARKER.length).join("") + TRUNCATION_MARKER
    : value;
}

type Candidate = { id?: unknown; kind?: unknown; content?: unknown; status?: unknown; parent?: unknown; reason?: unknown; owner?: unknown };

function normalize(input: unknown): TodoItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { id: "?", content: "(invalid item)", status: "pending" };
  const candidate = input as Candidate;
  const id = String(candidate.id ?? "").trim() || "?";
  const content = String(candidate.content ?? "").trim();
  if (!content) throw new Error(`Todo item '${id}' has empty or missing content.`);
  const kind = String(candidate.kind ?? "").trim().toLowerCase();
  if (kind && kind !== "phase") throw new Error(`Todo item '${id}' has invalid kind '${kind}'; only "phase" is allowed, omit kind for tasks.`);
  if (kind) {
    for (const key of ["status", "parent", "reason", "owner"] as const) {
      if (String(candidate[key] ?? "").trim()) throw new Error(`Phase '${id}' must not have ${key}; phases are titles only.`);
    }
    return { id, kind: "phase", content: capContent(content) };
  }
  const rawStatus = String(candidate.status ?? "pending").trim().toLowerCase();
  const status = Object.hasOwn(STATUSES, rawStatus) ? rawStatus as TodoStatus : "pending";
  const result: TaskItem = { id, content: capContent(content), status };
  const parent = String(candidate.parent ?? "").trim();
  if (parent && parent !== id) result.parent = parent;
  if (status === "blocked") {
    const reason = String(candidate.reason ?? "").trim();
    if (!reason) throw new Error(`Blocked todo item '${id}' requires a non-empty reason.`);
    result.reason = capContent(reason);
  }
  const owner = String(candidate.owner ?? "").trim();
  if (owner) result.owner = capContent(owner);
  return result;
}

function sameItems(a: readonly TodoItem[], b: readonly TodoItem[]): boolean {
  return a.length === b.length && a.every((item, i) => {
    const other = b[i]!;
    return item.id === other.id && item.kind === other.kind && item.content === other.content && item.status === other.status
      && item.parent === other.parent && item.reason === other.reason && item.owner === other.owner;
  });
}

function writeItems(current: readonly TodoItem[], inputs: unknown[], merge: boolean): TodoItem[] {
  const lastIndex = new Map<string, number>();
  inputs.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) lastIndex.set(`__invalid_${index}`, index);
    else {
      const candidate = item as { id?: unknown };
      lastIndex.set(String(candidate.id ?? "").trim() || "?", index);
    }
  });
  const next = merge ? current.map(item => ({ ...item })) : [];
  const existing = new Map(next.map((item, index) => [item.id, index]));
  for (const index of [...lastIndex.values()].sort((a, b) => a - b)) {
    const input = inputs[index]!;
    const candidate = input && typeof input === "object" && !Array.isArray(input) ? input as Candidate : undefined;
    const id = String(candidate?.id ?? "").trim();
    if (merge && !id) continue;
    const position = existing.get(id);
    if (position === undefined) next.push(normalize(input));
    else {
      const old = next[position]!;
      const patch = candidate ?? {};
      const merged = { ...old, ...patch };
      if (Object.hasOwn(patch, "content") && !String(patch.content ?? "").trim()) merged.content = old.content;
      if (!Object.hasOwn(patch, "parent")) merged.parent = old.parent;
      if (!Object.hasOwn(patch, "reason")) merged.reason = old.reason;
      next[position] = normalize(merged);
    }
  }
  // Hermes lift only for a flat list with exactly one in_progress; parallel work keeps author order.
  if (!next.some(item => item.parent || item.kind === "phase") && next.filter(item => item.status === "in_progress").length === 1) {
    const active = next.findIndex(item => item.status === "in_progress");
    const pending = next.findIndex(item => item.status === "pending");
    if (pending >= 0 && active > pending) next.splice(pending, 0, next.splice(active, 1)[0]!);
  }
  next.splice(MAX_ITEMS);
  const byId = new Map(next.map(item => [item.id, item]));
  for (const item of next) {
    if (item.parent && !byId.has(item.parent)) delete item.parent;
  }
  for (const item of next) {
    const seen = new Set([item.id]);
    let node = item;
    while (node.parent) {
      if (seen.has(node.parent)) {
        delete item.parent;
        break;
      }
      seen.add(node.parent);
      node = byId.get(node.parent)!;
    }
  }
  // Three levels at most: phase → task → subtask. A subtask's parent must be a task, never another subtask.
  for (const item of next) {
    const parent = item.parent ? byId.get(item.parent) : undefined;
    const grandparent = parent?.parent ? byId.get(parent.parent) : undefined;
    if (grandparent && grandparent.kind !== "phase") throw new Error(`Todo item '${item.id}' is nested too deeply: at most phase → task → subtask (three levels); its parent '${parent!.id}' is already a subtask.`);
  }
  return next;
}
