import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AddProjectDialog } from "./add-project-dialog";

const repo = (fullName: string, defaultBranch = "main", project: string | null = null) => {
  const [owner, name] = fullName.split("/") as [string, string];
  return { id: fullName.length, owner, name, fullName, defaultBranch, private: false, description: null, pushedAt: null, archived: false, project };
};

const actions = vi.hoisted(() => ({
  listReposAction: vi.fn(),
  createProjectAction: vi.fn(async () => ({})),
}));
vi.mock("@/app/projects/actions", () => actions);


beforeEach(() => {
  actions.listReposAction.mockReset();
  actions.createProjectAction.mockClear();
});

async function openPicker() {
  render(<AddProjectDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  const trigger = await screen.findByRole("combobox", { name: "GitHub repository" });
  fireEvent.click(trigger);
  return screen.findByPlaceholderText("Search repositories");
}

test("choosing a repository fills in its default branch and names the project after it", async () => {
  actions.listReposAction.mockResolvedValue({ repos: [repo("octo/sample"), repo("octo/Other_Repo", "trunk")] });
  const search = await openPicker();
  fireEvent.change(search, { target: { value: "other" } });
  const options = screen.getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("octo/Other_Repo")]);
  fireEvent.click(options[0]!);
  expect(screen.getByRole("combobox", { name: "GitHub repository" })).toHaveTextContent("octo/Other_Repo");
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Default branch")).toHaveValue("trunk");
});

test("a repository that already is a project is shown with its project and cannot be chosen", async () => {
  actions.listReposAction.mockResolvedValue({ repos: [repo("octo/sample", "main", "sandbox")] });
  await openPicker();
  const option = screen.getByRole("option");
  expect(within(option).getByText("sandbox")).toBeInTheDocument();
  expect(option).toHaveAttribute("aria-disabled", "true");
});

test("adding submits the chosen repository and branch", async () => {
  actions.listReposAction.mockResolvedValue({ repos: [repo("octo/sample")] });
  await openPicker();
  fireEvent.click(screen.getByRole("option"));
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  await waitFor(() => expect(actions.createProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.createProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(Object.fromEntries(form)).toEqual({ repo: "octo/sample", defaultBranch: "main" });
});

test("without GitHub access the dialog asks for owner/name instead", async () => {
  actions.listReposAction.mockResolvedValue({ error: "GitHub is not configured" });
  render(<AddProjectDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  expect(await screen.findByText(/GitHub is not configured/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText("owner/name")).toBeInTheDocument();
});

test("search matches repositories whose name or description contains the text", async () => {
  actions.listReposAction.mockResolvedValue({
    repos: [repo("octo/prisma-timescaledb"), repo("octo/the-important-message-scale"), { ...repo("octo/tools"), description: "TimescaleDB helpers" }],
  });
  const search = await openPicker();
  fireEvent.change(search, { target: { value: "timescale" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("prisma-timescaledb"), expect.stringContaining("octo/tools")]);
});
