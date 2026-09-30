import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { parseProjectTab } from "@/lib/project-tab";
import { ProjectTabs } from "./project-tabs";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

test("parseProjectTab defaults to runs and ignores unknown tabs", () => {
  expect(parseProjectTab({})).toBe("runs");
  expect(parseProjectTab({ tab: "pulls" })).toBe("pulls");
  expect(parseProjectTab({ tab: "settings" })).toBe("settings");
  expect(parseProjectTab({ tab: "issues" })).toBe("issues");
  expect(parseProjectTab({ tab: "nope" })).toBe("runs");
});

test("the tabs show counts, mark the current one and keep the choice in the URL", () => {
  render(
    <ProjectTabs active="runs" counts={{ runs: 8, pulls: 2 }}>
      <p>runs content</p>
    </ProjectTabs>,
  );
  expect(screen.getByRole("tab", { name: /Runs 8/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("runs content")).toBeInTheDocument();
  const pulls = screen.getByRole("tab", { name: /Pull requests 2/ });
  fireEvent.mouseDown(pulls, { button: 0 });
  expect(push).toHaveBeenCalledWith("?tab=pulls", { scroll: false });
});
