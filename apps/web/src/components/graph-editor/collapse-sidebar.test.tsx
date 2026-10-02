import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { CollapseSidebar } from "./collapse-sidebar";

const page = (editing: boolean) => (
  <SidebarProvider>
    <Sidebar collapsible="icon" />
    {editing && <CollapseSidebar />}
  </SidebarProvider>
);

test("the graph editor collapses the sidebar while it is open and gives it back when it closes", () => {
  const { container, rerender } = render(page(true));
  const state = () => container.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state");
  expect(state()).toBe("collapsed");
  rerender(page(false));
  expect(state()).toBe("expanded");
});
