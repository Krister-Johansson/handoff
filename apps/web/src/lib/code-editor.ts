import { useSyncExternalStore } from "react";

/** The editors a run's worktree opens in, with the URL scheme each one registers. */
export const CODE_EDITORS = [
  { value: "vscode", label: "VS Code", scheme: "vscode" },
  { value: "vscode-insiders", label: "VS Code Insiders", scheme: "vscode-insiders" },
] as const;

export type CodeEditor = (typeof CODE_EDITORS)[number]["value"];

const KEY = "handoff.code-editor";
const CHANGED = "handoff:code-editor";
const DEFAULT: CodeEditor = "vscode";
// Where storage is blocked, the choice lives in memory until the page reloads.
let memory: CodeEditor | undefined;

const editorOf = (value: CodeEditor) => CODE_EDITORS.find((e) => e.value === value) ?? CODE_EDITORS[0];

export const editorLabel = (value: CodeEditor) => editorOf(value).label;

/**
 * `<scheme>://file/<absolute path>`, which VS Code documents for a file or a folder. VS Code parses the
 * link as a URI and decodes its path, so each segment is percent-encoded: a space, #, ? or % in a folder
 * name reaches the editor as it is.
 */
export function editorUrl(editor: CodeEditor, path: string): string {
  return `${editorOf(editor).scheme}://file${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The editor this browser opens worktrees in: VS Code unless another one was picked here. */
export function readCodeEditor(): CodeEditor {
  try {
    const stored = localStorage.getItem(KEY);
    return CODE_EDITORS.some((e) => e.value === stored) ? (stored as CodeEditor) : DEFAULT;
  } catch {
    return memory ?? DEFAULT;
  }
}

export function writeCodeEditor(editor: CodeEditor) {
  try {
    localStorage.setItem(KEY, editor);
  } catch {
    memory = editor;
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** This browser's code editor, kept current when it changes here or in another tab. The server renders VS Code. */
export function useCodeEditor(): CodeEditor {
  return useSyncExternalStore(subscribe, readCodeEditor, () => DEFAULT);
}
