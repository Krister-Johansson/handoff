import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GroupForm } from "./group-form";

const actions = vi.hoisted(() => ({ saveGroup: vi.fn(async () => ({ ok: true, message: "Saved version 1." })) }));
vi.mock("@/app/library/actions", () => actions);

const library = { skills: ["shadcn", "tdd"], mcp: ["docs"], agents: ["explorer"] };

test("a group is saved with the entries ticked, and an existing group opens with its entries ticked", async () => {
  render(<GroupForm library={library} initial={{ name: "frontend", description: "UI work", skills: ["shadcn"], mcp: [], agents: [] }} />);
  expect(screen.getByRole("checkbox", { name: "shadcn" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "tdd" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "explorer" }));
  fireEvent.click(screen.getByRole("button", { name: "Save group" }));
  await waitFor(() => expect(actions.saveGroup).toHaveBeenCalled());
  const form = (actions.saveGroup.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("name")).toBe("frontend");
  expect(form.getAll("skills")).toEqual(["shadcn", "tdd"]);
  expect(form.getAll("agents")).toEqual(["explorer"]);
  expect(await screen.findByText("Saved version 1.")).toBeInTheDocument();
});
