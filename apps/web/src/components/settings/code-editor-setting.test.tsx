import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CodeEditorSetting } from "./code-editor-setting";

test("VS Code is the editor until a person picks VS Code Insiders, which this browser keeps", () => {
  render(<CodeEditorSetting />);
  expect(screen.getByRole("radiogroup", { name: "Code editor" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "VS Code" })).toBeChecked();
  expect(screen.getByText("vscode://file/")).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Cursor" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "VS Code Insiders" }));
  expect(screen.getByRole("radio", { name: "VS Code Insiders" })).toBeChecked();
  expect(window.localStorage.getItem("handoff.code-editor")).toBe("vscode-insiders");
  expect(screen.getByText("The editor has to be installed on this machine. Your browser may ask before it opens it the first time.")).toBeInTheDocument();
});
