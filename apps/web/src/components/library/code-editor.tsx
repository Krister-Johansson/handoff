"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type EditorProps = { value: string; onChange: (value: string) => void; label: string; isMarkdown: boolean; dark: boolean };

// CodeMirror, the markdown language and its code-block languages are large and need the DOM, so they
// load in the browser when an editor is first shown. The extension lists are built once per load.
const Editor = dynamic(
  async () => {
    const [{ default: CodeMirror }, { markdown, markdownLanguage }, { languages }, { EditorView }] = await Promise.all([
      import("@uiw/react-codemirror"),
      import("@codemirror/lang-markdown"),
      import("@codemirror/language-data"),
      import("@codemirror/view"),
    ]);
    const markdownExtensions = [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping];
    const plainExtensions = [EditorView.lineWrapping];
    return function LoadedEditor({ value, onChange, label, isMarkdown, dark }: EditorProps) {
      return (
        <CodeMirror
          value={value}
          onChange={onChange}
          theme={dark ? "dark" : "light"}
          extensions={isMarkdown ? markdownExtensions : plainExtensions}
          basicSetup={{ foldGutter: false, highlightActiveLine: false }}
          minHeight="24rem"
          aria-label={label}
          className="overflow-hidden rounded-md border text-sm"
        />
      );
    };
  },
  { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> },
);

// The app is dark when <html> has the .dark class (Tailwind's class-based dark variant).
const isDark = () => document.documentElement.classList.contains("dark");
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};

/** CodeMirror with markdown highlighting (and highlighted code blocks) or plain text, in the app's theme. */
export function CodeEditor(props: Omit<EditorProps, "dark">) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return <Editor {...props} dark={dark} />;
}
