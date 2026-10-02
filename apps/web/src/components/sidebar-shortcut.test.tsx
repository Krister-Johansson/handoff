import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";

test("Cmd/Ctrl+B toggles the sidebar and is ignored in a text field", () => {
  const { container } = render(
    <SidebarProvider>
      <Sidebar collapsible="icon" />
      <input aria-label="Search" />
      <textarea aria-label="Message" />
      <div contentEditable aria-label="Notes" role="textbox" />
    </SidebarProvider>,
  );
  const state = () => container.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state");
  expect(state()).toBe("expanded");

  fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
  expect(state()).toBe("collapsed");
  fireEvent.keyDown(document.body, { key: "b", metaKey: true });
  expect(state()).toBe("expanded");

  // Typing keeps Cmd/Ctrl+B for the field, such as bold in an editor.
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), { key: "b", ctrlKey: true });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "b", metaKey: true });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "b", ctrlKey: true });
  expect(state()).toBe("expanded");
});
