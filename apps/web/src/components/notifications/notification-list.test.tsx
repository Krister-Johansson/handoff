import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { NotificationList } from "./notification-list";

test("each notification links to its run, says how long ago it came, and unread ones are marked", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  render(
    <NotificationList
      now={now}
      items={[
        { id: "q1", tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: "/projects/p1/runs/r1", createdAt: new Date("2026-10-01T11:55:00Z"), unread: true },
        { id: "e1", tone: "success", title: "sandbox: run finished", body: "Add a CHANGELOG.md", href: "/projects/p1/runs/r2", createdAt: "2026-09-30T12:00:00Z", unread: false },
      ]}
    />,
  );
  const [question, finished] = screen.getAllByRole("link");
  expect(question).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(question).toHaveTextContent("5 minutes ago");
  expect(within(question!).getByLabelText("unread")).toBeInTheDocument();
  expect(finished).toHaveTextContent("1 day ago");
  expect(within(finished!).queryByLabelText("unread")).not.toBeInTheDocument();
});

test("a notification without a link is shown as text, and none is checked off as done", () => {
  render(
    <NotificationList
      items={[
        { id: "n1", tone: "neutral", title: "The worker restarted", body: "", href: null, createdAt: new Date(), unread: true },
        { id: "q1", tone: "attention", title: "sandbox: the plan from planner-1 needs your review", body: "#9 F09", href: "/projects/p1/runs/r1/review/q1", createdAt: new Date(), unread: false },
      ]}
    />,
  );
  expect(screen.getByText("The worker restarted").closest("a")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByText("Done")).not.toBeInTheDocument();
});
