import { expect, test } from "vitest";
import { isMacPlatform, modKeyLabel } from "../platform";
import { isSearchShortcut } from "./shortcut";

const key = (init: KeyboardEventInit, target?: EventTarget) => {
  const event = new KeyboardEvent("keydown", { key: "k", ...init });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
};
const input = document.createElement("input");
const div = document.createElement("div");

test("Cmd+K and Ctrl+K open search on every system, in a text field too", () => {
  for (const mac of [true, false]) {
    expect(isSearchShortcut(key({ metaKey: true }, div), mac)).toBe(true);
    expect(isSearchShortcut(key({ metaKey: true }, input), mac)).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: true }, div), mac)).toBe(true);
    expect(isSearchShortcut(key({ key: "K", ctrlKey: true }, div), mac)).toBe(true);
  }
  expect(isSearchShortcut(key({ ctrlKey: true }, input), false)).toBe(true);
});

test("on a Mac, Ctrl+K in a text field stays delete to end of line", () => {
  expect(isSearchShortcut(key({ ctrlKey: true }, input), true)).toBe(false);
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  expect(isSearchShortcut(key({ ctrlKey: true }, editable), true)).toBe(false);
  expect(isSearchShortcut(key({ ctrlKey: true }, document.createElement("textarea")), true)).toBe(false);
});

test("K alone, or with Alt or Shift, is not the shortcut", () => {
  expect(isSearchShortcut(key({}, div), false)).toBe(false);
  expect(isSearchShortcut(key({ ctrlKey: true, altKey: true }, div), false)).toBe(false);
  expect(isSearchShortcut(key({ metaKey: true, shiftKey: true }, div), true)).toBe(false);
  expect(isSearchShortcut(key({ key: "j", ctrlKey: true }, div), false)).toBe(false);
});

test("the shortcut label reads ⌘ on a Mac and Ctrl elsewhere", () => {
  expect(isMacPlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
  expect(isMacPlatform({ platform: "iPhone", userAgent: "" })).toBe(true);
  expect(isMacPlatform({ platform: "Win32", userAgent: "" })).toBe(false);
  expect(isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(true);
  expect(isMacPlatform({ platform: "Linux x86_64", userAgent: "X11; Linux" })).toBe(false);
  expect(modKeyLabel(true)).toBe("⌘");
  expect(modKeyLabel(false)).toBe("Ctrl");
});
