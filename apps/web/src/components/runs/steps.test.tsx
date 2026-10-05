import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Steps, type StepView } from "./steps";

const step = (over: Partial<StepView>): StepView => ({ id: "e1", nodeKey: "pr", attempt: 2, status: "waiting", costUsd: null, durationMs: null, ...over });

test("a PR step waiting for a reviewer's next review says whose, on how many comments, since when and when it asks, waiting on review", () => {
  const since = "2026-10-05T14:31:00Z";
  const until = "2026-10-05T15:01:00Z";
  render(<Steps steps={[step({ reReview: { whose: "CodeRabbit's next review", items: 7, since, until } })]} labels={{ pr: "Pull request" }} onSelect={vi.fn()} />);
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  expect(screen.getByText(/Waiting for CodeRabbit's next review on 7 comments since/)).toHaveTextContent(
    `Waiting for CodeRabbit's next review on 7 comments since ${clock(since)}; asks you at ${clock(until)}`,
  );
  expect(screen.getByText("waiting on review")).toHaveAttribute("data-tone", "active");
});

test("a waiting step without a review wait says it waits", () => {
  render(<Steps steps={[step({})]} labels={{ pr: "Pull request" }} onSelect={vi.fn()} />);
  expect(screen.getByText("Waiting…")).toBeInTheDocument();
  expect(screen.getByText("waiting")).toHaveAttribute("data-tone", "attention");
});
