import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { beforeEach, expect, test, vi } from "vitest";
import { ThemeSetting } from "./theme-setting";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  // jsdom has no matchMedia; the system theme reads as light.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
});

const renderSetting = () =>
  render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeSetting />
    </ThemeProvider>,
  );

test("the theme follows the system until a person picks dark or light, which this browser keeps", () => {
  renderSetting();
  expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(document.documentElement).toHaveClass("dark");
  expect(window.localStorage.getItem("theme")).toBe("dark");
  fireEvent.click(screen.getByRole("radio", { name: "Light" }));
  expect(document.documentElement).not.toHaveClass("dark");
  expect(window.localStorage.getItem("theme")).toBe("light");
});
