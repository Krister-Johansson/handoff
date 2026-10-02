import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { parseNotificationFilter } from "./filters";
import { NotificationFeed, NotificationFilters } from "./notification-feed";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

test("the feed groups notifications by day, newest first, with how long ago today and the time on earlier days", () => {
  const now = at(1, 12);
  render(
    <NotificationFeed
      now={now}
      items={[
        { id: "q1", tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: "/projects/p1/runs/r1", createdAt: at(1, 11, 50), unread: true },
        { id: "e1", tone: "neutral", title: "sandbox: run started", body: "Add a CHANGELOG.md", href: "/projects/p1/runs/r1", createdAt: at(1, 9), unread: false },
        { id: "e2", tone: "success", title: "sandbox: run finished", body: "Add usage docs", href: "/projects/p1/runs/r2", createdAt: new Date(2026, 8, 30, 16, 40), unread: false },
        { id: "e3", tone: "danger", title: "sandbox: run failed at coder", body: "Add a truncate helper", href: "/projects/p1/runs/r3", createdAt: new Date(2026, 8, 29, 18, 21).toISOString(), unread: false },
      ]}
    />,
  );
  const groups = screen.getAllByRole("group");
  expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Today", "Yesterday", "2 days ago"]);
  const [question, started] = within(groups[0]!).getAllByRole("link");
  expect(question).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(question).toHaveTextContent("sandbox: gate asks a question");
  expect(question).toHaveTextContent("10 minutes ago");
  expect(within(question!).getByLabelText("unread")).toBeInTheDocument();
  expect(within(started!).queryByLabelText("unread")).not.toBeInTheDocument();
  expect(within(groups[1]!).getByRole("link")).toHaveTextContent("16:40");
  expect(within(groups[2]!).getByRole("link")).toHaveTextContent("18:21");
});

test("days a week or more back are headed by their date", () => {
  render(
    <NotificationFeed
      now={at(1, 12)}
      items={[{ id: "e1", tone: "neutral", title: "sandbox: run started", body: "Old run", href: "/projects/p1/runs/r1", createdAt: new Date(2026, 8, 20, 10, 5), unread: false }]}
    />,
  );
  expect(screen.getByRole("group")).toHaveAccessibleName("Sep 20");
});

test("the filters link to the feed narrowed to unread items or one tone, and mark the current one", () => {
  render(<NotificationFilters current="danger" unread={2} />);
  const links = screen.getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["All", "/notifications"],
    ["Unread 2", "/notifications?show=unread"],
    ["Asked you", "/notifications?show=attention"],
    ["Finished", "/notifications?show=success"],
    ["Failed", "/notifications?show=danger"],
  ]);
  expect(screen.getByRole("link", { name: "Failed" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
});

test("only known filters are read from the address", () => {
  expect(parseNotificationFilter("unread")).toBe("unread");
  expect(parseNotificationFilter("attention")).toBe("attention");
  expect(parseNotificationFilter("input")).toBeUndefined();
  expect(parseNotificationFilter("neutral")).toBeUndefined();
  expect(parseNotificationFilter("nonsense")).toBeUndefined();
  expect(parseNotificationFilter(["danger"])).toBeUndefined();
  expect(parseNotificationFilter(undefined)).toBeUndefined();
});

test("the feed lists a notification without a link as text, and checks nothing off as done", () => {
  render(
    <NotificationFeed
      now={at(1, 12)}
      items={[
        { id: "n1", tone: "neutral", title: "The worker restarted", body: "", href: null, createdAt: at(1, 11), unread: false },
        { id: "e1", tone: "attention", title: "sandbox: PR #54 is ready to merge", body: "Add a CHANGELOG.md", href: "/projects/p1/runs/r1", createdAt: at(1, 10), unread: false },
      ]}
    />,
  );
  expect(screen.getByText("The worker restarted").closest("a")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByText("Done")).not.toBeInTheDocument();
});
