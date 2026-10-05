import { afterEach, expect, test, vi } from "vitest";
import { editorUrl, readCodeEditor, writeCodeEditor } from "./code-editor";

afterEach(() => vi.restoreAllMocks());

test("each editor opens a folder through its own file link", () => {
  expect(editorUrl("vscode", "/Users/krister/.handoff/worktrees/7f3a2c1e")).toBe("vscode://file/Users/krister/.handoff/worktrees/7f3a2c1e");
  expect(editorUrl("vscode-insiders", "/Users/krister/.handoff/worktrees/7f3a2c1e")).toBe("vscode-insiders://file/Users/krister/.handoff/worktrees/7f3a2c1e");
});

test("the path is percent-encoded segment by segment, so spaces and URL characters reach the editor as they are", () => {
  expect(editorUrl("vscode", "/Users/k/My Work/#1 ?x%/worktrees/7f3a2c1e")).toBe("vscode://file/Users/k/My%20Work/%231%20%3Fx%25/worktrees/7f3a2c1e");
  expect(editorUrl("vscode", "/Users/k/Åsa/worktrees/7f3a2c1e")).toBe("vscode://file/Users/k/%C3%85sa/worktrees/7f3a2c1e");
});

test("the choice is VS Code until this browser keeps another one", () => {
  expect(readCodeEditor()).toBe("vscode");
  writeCodeEditor("vscode-insiders");
  expect(window.localStorage.getItem("handoff.code-editor")).toBe("vscode-insiders");
  expect(readCodeEditor()).toBe("vscode-insiders");
  window.localStorage.setItem("handoff.code-editor", "notepad");
  expect(readCodeEditor()).toBe("vscode");
});

test("with storage blocked the choice lasts for this page", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readCodeEditor()).toBe("vscode");
  expect(() => writeCodeEditor("vscode-insiders")).not.toThrow();
  expect(readCodeEditor()).toBe("vscode-insiders");
});
