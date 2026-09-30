import { expect, test } from "vitest";
import { quoteRanges } from "./quote-ranges";

test("a quote is found across elements, whatever the whitespace between them", () => {
  const root = document.createElement("article");
  root.innerHTML = "<p>Store todos in a <strong>JSON</strong>\n file and add a CLI.</p><ol><li>Add storage</li></ol>";
  const [range] = quoteRanges(root, "todos in a JSON file");
  expect(range?.toString().replace(/\s+/g, " ")).toBe("todos in a JSON file");
  expect(quoteRanges(root, "not in the plan")).toEqual([]);
});
