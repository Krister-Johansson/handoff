import { bundledLanguagesInfo, codeToTokens, type BundledLanguage } from "shiki";
import type { DiffFile, DiffLine } from "@handoff/core";
import type { LineTokens, Token } from "@/lib/highlight-types";

/** Highlighting stops after this many lines in one review, to keep the page light. */
const MAX_LINES = 8_000;

const BY_NAME: Record<string, string> = { dockerfile: "docker", makefile: "make" };

/** The Shiki language for a file, from its name or extension; "text" when Shiki has none. */
export function languageOf(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = name.includes(".") && !name.startsWith(".") ? name.split(".").pop()! : name.startsWith(".") && name.split(".").length > 2 ? name.split(".").pop()! : "";
  if (!ext) return "text";
  const found = bundledLanguagesInfo.find((l) => l.id === ext || l.aliases?.includes(ext));
  return found?.id ?? "text";
}

/** One version of a file as far as the diff shows it: its lines in order with their numbers. */
function version(file: DiffFile, side: "old" | "new") {
  const lines = file.hunks.flatMap((h) => h.lines).filter((l: DiffLine) => (side === "new" ? l.kind !== "del" : l.kind !== "add"));
  return { numbers: lines.map((l) => (side === "new" ? l.newLine! : l.oldLine!)), code: lines.map((l) => l.text).join("\n") };
}

async function tokenize(code: string, lang: string, numbers: number[]): Promise<Record<number, Token[]>> {
  const { tokens } = await codeToTokens(code, { lang: lang as BundledLanguage, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
  const byLine: Record<number, Token[]> = {};
  tokens.forEach((line, i) => {
    const n = numbers[i];
    if (n !== undefined) byLine[n] = line.map((t) => ({ content: t.content, ...(t.htmlStyle && typeof t.htmlStyle === "object" ? { style: t.htmlStyle as Record<string, string> } : {}) }));
  });
  return byLine;
}

/**
 * Colours the old and new version of every shown file, by line number, with light and dark colours
 * as CSS variables. Generated, large and binary files and plain text are left as they are.
 */
export async function highlightFiles(files: DiffFile[]): Promise<Record<string, LineTokens>> {
  let budget = MAX_LINES;
  const shown = files.flatMap((file) => {
    if (file.collapsed || file.status === "binary" || file.hunks.length === 0) return [];
    const lang = languageOf(file.path);
    if (lang === "text") return [];
    const before = version(file, "old");
    const after = version(file, "new");
    budget -= before.numbers.length + after.numbers.length;
    return budget < 0 ? [] : [{ file, lang, before, after }];
  });
  const done = await Promise.all(
    shown.map(async ({ file, lang, before, after }) => {
      try {
        const [old, next] = await Promise.all([
          before.numbers.length ? tokenize(before.code, lang, before.numbers) : undefined,
          after.numbers.length ? tokenize(after.code, lang, after.numbers) : undefined,
        ]);
        return [file.path, { ...(old ? { old } : {}), ...(next ? { new: next } : {}) }] as const;
      } catch {
        // A grammar that fails on odd input leaves that file uncoloured.
        return undefined;
      }
    }),
  );
  return Object.fromEntries(done.filter((d) => d !== undefined));
}
