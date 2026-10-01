import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "./url-tabs";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

test("choosing a tab puts it in ?tab= and keeps the other search params", () => {
  window.history.replaceState(null, "", "/library?tab=skills&q=react");
  render(
    <UrlTabs value="skills">
      <TabsList>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
      </TabsList>
    </UrlTabs>,
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Agents" }));
  expect(router.replace).toHaveBeenCalledWith("?tab=agents&q=react", { scroll: false });
});
