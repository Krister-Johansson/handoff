import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SkillEditor } from "./skill-editor";

const actions = vi.hoisted(() => ({ saveSkill: vi.fn(async () => ({ ok: true, message: "Saved" })), deleteEntry: vi.fn(), saveMcpServer: vi.fn(), saveAgent: vi.fn() }));
vi.mock("@/app/library/actions", () => actions);
// CodeMirror needs a real layout engine; the editor is a textarea here.
vi.mock("./markdown-editor", () => ({
  MarkdownEditor: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const existing = {
  name: "tdd",
  description: "Test first",
  body: "# TDD",
  frontmatter: { license: "MIT" },
  files: [{ path: "mocking.md", content: "# Mocks" }],
};

const submitted = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
  await waitFor(() => expect(actions.saveSkill).toHaveBeenCalled());
  return Object.fromEntries((actions.saveSkill.mock.calls.at(-1) as unknown[])[1] as FormData) as Record<string, string>;
};

test("an existing skill opens on SKILL.md, shows its files, and keeps its name", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor skill={existing} />);
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.getByLabelText("SKILL.md")).toHaveValue("# TDD");
  fireEvent.click(screen.getByRole("button", { name: "mocking.md" }));
  expect(screen.getByLabelText("mocking.md")).toHaveValue("# Mocks");
  const form = await submitted();
  expect(form).toMatchObject({ name: "tdd", description: "Test first", body: "# TDD", frontmatter: "license: MIT\n" });
  expect(JSON.parse(form.files!)).toEqual(existing.files);
});

test("adding and editing a supporting file sends it with the skill", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor skill={existing} />);
  fireEvent.change(screen.getByLabelText("New file path"), { target: { value: "examples/basic.md" } });
  fireEvent.click(screen.getByRole("button", { name: "Add file" }));
  fireEvent.change(screen.getByLabelText("examples/basic.md"), { target: { value: "An example" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove mocking.md" }));
  expect(JSON.parse((await submitted()).files!)).toEqual([{ path: "examples/basic.md", content: "An example" }]);
});

test("a new skill asks for a name and marks the form as new", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ci-triage" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "When CI fails" } });
  fireEvent.change(screen.getByLabelText("SKILL.md"), { target: { value: "Read the failing job log first." } });
  expect(await submitted()).toMatchObject({ name: "ci-triage", description: "When CI fails", body: "Read the failing job log first.", $new: "1" });
});
