import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { IssueMarkdown } from "./issue-markdown";

const REPO = { projectId: "p1", repoUrl: "https://github.com/Krister-Johansson/todoOverKill" };

test("a body renders as Markdown with read-only checkboxes and code", () => {
  render(<IssueMarkdown {...REPO}>{"## Acceptance criteria\n\n- [ ] Cards can be dragged\n- [x] Escape cancels\n\nRun `pnpm test`."}</IssueMarkdown>);
  expect(screen.getByRole("heading", { name: "Acceptance criteria" })).toBeInTheDocument();
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes.map((b) => [(b as HTMLInputElement).checked, (b as HTMLInputElement).disabled])).toEqual([
    [false, true],
    [true, true],
  ]);
  expect(screen.getByText("pnpm test").tagName).toBe("CODE");
});

test("a reference such as #145, or a link to an issue of the repository, opens that issue's page in handoff", () => {
  render(
    <IssueMarkdown {...REPO}>
      {"Depends on: #15 (F15), #8.\n\nSee https://github.com/Krister-Johansson/todoOverKill/issues/145 and [the PR](https://github.com/Krister-Johansson/todoOverKill/pull/3).\n\n`#99 in code`"}
    </IssueMarkdown>,
  );
  expect(screen.getByRole("link", { name: "#15" })).toHaveAttribute("href", "/projects/p1/issues/15");
  expect(screen.getByRole("link", { name: "#8" })).toHaveAttribute("href", "/projects/p1/issues/8");
  expect(screen.getByRole("link", { name: "https://github.com/Krister-Johansson/todoOverKill/issues/145" })).toHaveAttribute("href", "/projects/p1/issues/145");
  expect(screen.getByRole("link", { name: "the PR" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/pull/3");
  expect(screen.queryByRole("link", { name: "#99" })).not.toBeInTheDocument();
  expect(screen.getByText("#99 in code")).toBeInTheDocument();
});

test("images GitHub holds show, as Markdown or as HTML; comments and scripts in a body stay hidden", () => {
  const { container } = render(
    <IssueMarkdown {...REPO}>
      {
        '<!-- handoff:notes -->\n\n![Board drag, light theme](https://github.com/user-attachments/assets/1)\n\n<img width="400" alt="Board drag, dark theme" src="https://github.com/user-attachments/assets/2" />\n\n<script>alert(1)</script>\n\nDone.'
      }
    </IssueMarkdown>,
  );
  expect(screen.getByRole("img", { name: "Board drag, light theme" })).toHaveAttribute("src", "https://github.com/user-attachments/assets/1");
  expect(screen.getByRole("img", { name: "Board drag, dark theme" })).toHaveAttribute("src", "https://github.com/user-attachments/assets/2");
  expect(container.innerHTML).not.toContain("handoff:notes");
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("Done.")).toBeInTheDocument();
});
