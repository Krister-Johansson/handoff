/** A run's task as the page shows it: the first line is the title, the rest (a split part's body, say) its body. */
export function taskParts(task: string): { title: string; body: string } {
  const at = task.indexOf("\n");
  return at === -1 ? { title: task.trim(), body: "" } : { title: task.slice(0, at).trim(), body: task.slice(at + 1).trim() };
}
