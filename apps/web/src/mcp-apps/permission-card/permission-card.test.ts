import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { deferred, errorResult, mountView, textResult, unmountViews } from "../testing";
import { startPermissionCard } from "./main";

const RUN_URL = "http://localhost:3000/projects/p1/runs/7f3a2c1e-0000-4000-8000-000000000001";
const inbox = {
  permissions: [{ id: "perm1", project: "sandbox", run: "Add a CHANGELOG", node: "coder", tool: "Bash", asks: "asks to run a command", detail: "Runs the unit tests\npnpm test", url: RUN_URL }],
  reviews: [],
  questions: [],
  ready_to_merge: [],
  failed_runs: [],
  stuck_runs: [],
  pull_requests: [],
};

afterEach(unmountViews);

test("answer_permission's card shows the request while the answer is pending, then the decision and a link to the run", async () => {
  const listed = deferred<ReturnType<typeof textResult>>();
  const { bridge, calls } = await mountView(startPermissionCard, { input: { request_id: "perm1", decision: "allow" }, tools: { list_inbox: () => listed.promise } });
  const card = within(await screen.findByRole("article", { name: "Permission request" }));
  expect(card.getByRole("status")).toHaveTextContent("Allowing once…");
  // The request's step and command come from the Inbox while it still waits.
  listed.resolve(textResult(inbox));
  expect(await screen.findByRole("article", { name: "coder asks to run a command" })).toHaveTextContent("pnpm test");
  expect(calls).toEqual([{ name: "list_inbox", arguments: {} }]);
  await bridge.sendToolResult(textResult({ decision: "allowed", url: RUN_URL }));
  const answered = within(screen.getByRole("article", { name: "coder asks to run a command" }));
  await waitFor(() => expect(answered.getByRole("status")).toHaveTextContent("Allowed once."));
  expect(answered.getByRole("link", { name: "Open the run" })).toHaveAttribute("href", RUN_URL);
  expect(answered.queryByRole("button")).not.toBeInTheDocument();
});

test("a denial shows its note", async () => {
  await mountView(startPermissionCard, {
    input: { request_id: "perm1", decision: "deny", message: "Run pnpm test:unit instead" },
    result: textResult({ decision: "denied", url: RUN_URL }),
    tools: { list_inbox: () => textResult({ ...inbox, permissions: [] }) },
  });
  const card = within(await screen.findByRole("article", { name: "Permission request" }));
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Denied."));
  expect(card.getByText("Note: Run pnpm test:unit instead")).toBeInTheDocument();
});

test("a refused or failed answer is shown as its error", async () => {
  await mountView(startPermissionCard, {
    input: { request_id: "perm1", decision: "allow" },
    result: errorResult("permission request perm1 is not pending"),
    capabilities: { openLinks: {} },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("permission request perm1 is not pending");
});
