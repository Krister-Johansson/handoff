import { expect, test } from "vitest";
import { parseAnsi } from "./ansi";

const E = "\u001b";

test("colours, bold and dim become styled runs, and a reset ends them", () => {
  expect(parseAnsi(`${E}[32m✓${E}[39m src/a.test.ts ${E}[2m(1 test)${E}[22m`)).toEqual([
    [
      { text: "✓", fg: "green" },
      { text: " src/a.test.ts " },
      { text: "(1 test)", dim: true },
    ],
  ]);
  expect(parseAnsi(`${E}[1m${E}[31mFAIL${E}[0m done`)).toEqual([[{ text: "FAIL", fg: "red", bold: true }, { text: " done" }]]);
});

test("backgrounds and bright colours are kept, one list of runs per line", () => {
  expect(parseAnsi(`${E}[30m${E}[46m RUN ${E}[49m${E}[39m\n${E}[90mv5${E}[39m`)).toEqual([[{ text: " RUN ", fg: "black", bg: "cyan" }], [{ text: "v5", fg: "brightBlack" }]]);
});

test("other escape codes are dropped, and plain text passes through", () => {
  expect(parseAnsi(`${E}[2K${E}[1Gdone${E}]0;title\u0007 ok`)).toEqual([[{ text: "done ok" }]]);
  expect(parseAnsi("plain\n\nlines")).toEqual([[{ text: "plain" }], [], [{ text: "lines" }]]);
});
