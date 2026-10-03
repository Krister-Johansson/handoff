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

const header = { crumbs: [{ label: "Settings", href: "/settings" }, { label: "Skills", href: "/settings?tab=skills" }, { label: "tdd" }], title: "tdd" };

const submitted = async (save = /^Save/) => {
  fireEvent.click(screen.getByRole("button", { name: save }));
  await waitFor(() => expect(actions.saveSkill).toHaveBeenCalled());
  return Object.fromEntries((actions.saveSkill.mock.calls.at(-1) as unknown[])[1] as FormData) as Record<string, string>;
};

test("an existing skill opens on SKILL.md, shows its files, and keeps its name", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor header={header} skill={existing} version={2} />);
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByLabelText("Name")).toHaveValue("tdd");
  expect(screen.getByLabelText("SKILL.md")).toHaveValue("# TDD");
  fireEvent.click(screen.getByRole("button", { name: "mocking.md" }));
  expect(screen.getByLabelText("mocking.md")).toHaveValue("# Mocks");
  const form = await submitted(/Save as v3/);
  expect(form).toMatchObject({ name: "tdd", description: "Test first", body: "# TDD", frontmatter: "license: MIT\n" });
  expect(JSON.parse(form.files!)).toEqual(existing.files);
});

test("adding and editing a supporting file sends it with the skill", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor header={header} skill={existing} version={2} />);
  fireEvent.change(screen.getByLabelText("New file path"), { target: { value: "examples/basic.md" } });
  fireEvent.click(screen.getByRole("button", { name: "Add file" }));
  fireEvent.change(screen.getByLabelText("examples/basic.md"), { target: { value: "An example" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove mocking.md" }));
  expect(JSON.parse((await submitted()).files!)).toEqual([{ path: "examples/basic.md", content: "An example" }]);
});

test("a new skill asks for a name and marks the form as new", async () => {
  actions.saveSkill.mockClear();
  render(<SkillEditor header={header} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ci-triage" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "When CI fails" } });
  fireEvent.change(screen.getByLabelText("SKILL.md"), { target: { value: "Read the failing job log first." } });
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(await submitted(/Save skill/)).toMatchObject({ name: "ci-triage", description: "When CI fails", body: "Read the failing job log first.", $new: "1" });
});

test("a binary file is listed but not edited, and is saved unchanged", async () => {
  actions.saveSkill.mockClear();
  const font = { path: "fonts/Inter.ttf", content: "AAEA/w==", encoding: "base64" as const };
  render(<SkillEditor header={header} skill={{ ...existing, files: [font] }} version={2} />);
  fireEvent.click(screen.getByRole("button", { name: "fonts/Inter.ttf" }));
  expect(screen.getByText(/binary file/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("fonts/Inter.ttf")).not.toBeInTheDocument();
  expect(JSON.parse((await submitted()).files!)).toEqual([font]);
});

test("Discard changes is off until something changes, and puts the saved skill back", () => {
  render(<SkillEditor header={header} skill={existing} version={2} />);
  const discard = screen.getByRole("button", { name: "Discard changes" });
  expect(discard).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Tests later" } });
  fireEvent.change(screen.getByLabelText("New file path"), { target: { value: "extra.md" } });
  fireEvent.click(screen.getByRole("button", { name: "Add file" }));
  expect(discard).toBeEnabled();
  fireEvent.click(discard);
  expect(screen.getByLabelText("Description")).toHaveValue("Test first");
  expect(screen.queryByRole("button", { name: "extra.md" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("SKILL.md")).toHaveValue("# TDD");
  expect(discard).toBeDisabled();
});

test("Delete in the header deletes the skill by name", async () => {
  actions.deleteEntry.mockClear();
  render(<SkillEditor header={header} skill={existing} version={2} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(actions.deleteEntry).toHaveBeenCalled());
  const form = (actions.deleteEntry.mock.calls[0] as unknown[])[0] as FormData;
  expect(form.get("kind")).toBe("skill");
  expect(form.get("name")).toBe("tdd");
});
