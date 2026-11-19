// Widget text format: see docs/widget-format.md. PRK parses these lines; change both together.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskItem, TodoItem } from "./todo-store.js";

type Theme = ExtensionContext["ui"]["theme"];

const ROMAN: ReadonlyArray<readonly [number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

function roman(n: number): string {
  let out = "";
  for (const [value, symbol] of ROMAN) while (n >= value) { out += symbol; n -= value; }
  return out;
}

// Texts are single-spaced, so the first double space on an item line is always the owner separator (see docs/widget-format.md).
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Lines for one task or subtask: the item line, plus its reason line when blocked. */
export function taskLines(theme: Theme, item: TaskItem, indent: string): string[] {
  const text = oneLine(item.content);
  const owner = item.owner ? theme.fg("dim", `  · ${oneLine(item.owner)}`) : "";
  switch (item.status) {
    case "in_progress": return [indent + theme.fg("accent", theme.bold(`▸ ${text}`)) + owner];
    case "completed": return [indent + theme.fg("dim", `✓ ${text}`) + owner];
    case "cancelled": return [indent + theme.fg("dim", `✕ ${theme.strikethrough(text)}`) + owner];
    case "blocked": return [indent + theme.fg("warning", `! ${text}`) + owner, `${indent}  ${theme.fg("warning", oneLine(item.reason ?? ""))}`];
    default: return [indent + theme.fg("muted", `○ ${text}`) + owner];
  }
}

/** A changed item for the collapsed tool result: a phase is shown by its numbered name. */
export function changeLines(theme: Theme, item: TodoItem, todos: readonly TodoItem[]): string[] {
  if (item.kind !== "phase") return taskLines(theme, item, "");
  const number = todos.filter(other => other.kind === "phase").findIndex(other => other.id === item.id) + 1;
  return [theme.bold(`${roman(number)}. ${oneLine(item.content)}`)];
}

/** Header plus body lines. `fold: false` shows every task (expanded tool result). */
export function todoLines(theme: Theme, todos: readonly TodoItem[], fold = true): string[] {
  const configured = process.env.PRK_TODOLIST_COLLAPSE_COMPLETED?.trim();
  const threshold = configured && /^\d+$/.test(configured) ? Number(configured) : 3;
  const phases = todos.filter(item => item.kind === "phase");
  const byParent = new Map<string | undefined, TaskItem[]>();
  for (const item of todos) if (item.kind !== "phase") byParent.set(item.parent, [...(byParent.get(item.parent) ?? []), item]);
  const base = phases.length ? "  " : "";

  // One fold scope: the tasks of a phase, or the untitled group of unphased tasks.
  const block = (scope: readonly TaskItem[]): string[] => {
    const completed = scope.filter(task => task.status === "completed").length;
    const collapse = fold && threshold > 0 && completed >= threshold;
    let folded = false;
    return scope.flatMap(task => {
      if (collapse && task.status === "completed") {
        if (folded) return [];
        folded = true;
        return [base + theme.fg("dim", `✓ ${completed} completed`)];
      }
      return [...taskLines(theme, task, base), ...(byParent.get(task.id) ?? []).flatMap(sub => taskLines(theme, sub, `${base}  `))];
    });
  };

  const unphased = byParent.get(undefined) ?? [];
  const body = block(unphased);
  const top = [...unphased];
  phases.forEach((phase, index) => {
    const scope = byParent.get(phase.id) ?? [];
    top.push(...scope);
    const closed = scope.filter(task => task.status === "completed" || task.status === "cancelled").length;
    const color = scope.some(task => task.status === "in_progress") ? "accent" : "dim";
    body.push(theme.fg(color, theme.bold(`${roman(index + 1)}. ${oneLine(phase.content)}`)) + "  " + theme.fg("dim", `${closed}/${scope.length}`));
    if (!fold || closed < scope.length) body.push(...block(scope));
  });
  const closed = top.filter(task => task.status === "completed" || task.status === "cancelled").length;
  return [`${theme.bold("Todo")} ${theme.fg("dim", `${closed}/${top.length}`)}`, ...body];
}
