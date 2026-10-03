import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { IssueLoading, IssueNotFound, IssueUnreachable } from "./issue-states";
import { NOW, PROJECT_REF, waitingRun } from "./testing/issue-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/projects/p1/issues/16" }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => null }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

test("while GitHub is read, the number and the runs show at once and GitHub's parts wait as skeletons", () => {
  render(<IssueLoading project={PROJECT_REF} number={16} runs={[waitingRun()]} at={NOW.getTime()} />);
  expect(screen.getByText("#16")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Reading #16 from GitHub");
  expect(screen.getByRole("listitem", { name: /Run 64fde8ef/ })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Description" })).toBeInTheDocument();
});

test("when GitHub does not answer, the latest run's title stands in, the runs stay, and Try again reads GitHub again", () => {
  render(<IssueUnreachable project={PROJECT_REF} number={16} title="F16 Drag and drop on the board" runs={[waitingRun()]} now={NOW} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("F16 Drag and drop on the board");
  expect(screen.getByText("title from run 64fde8ef")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/issues/16");
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("GitHub did not answer");
  expect(alert).toHaveTextContent(
    "handoff could not read #16 from Krister-Johansson/todoOverKill. The description, the plan and the comments need GitHub. The runs below come from handoff.",
  );
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(router.refresh).toHaveBeenCalled();
  expect(screen.getByRole("listitem", { name: /Run 64fde8ef/ })).toBeInTheDocument();
});

test("a number that is not an issue of the repository says so and points to the plan and the issues", () => {
  render(<IssueNotFound project={PROJECT_REF} number={999} />);
  expect(screen.getByText("No issue #999 in Krister-Johansson/todoOverKill")).toBeInTheDocument();
  expect(screen.getByText("Check the number. A pull request number opens its pull request instead.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the plan" })).toHaveAttribute("href", "/projects/p1/plan");
  expect(screen.getByRole("link", { name: "Open Issues" })).toHaveAttribute("href", "/projects/p1/issues");
});
