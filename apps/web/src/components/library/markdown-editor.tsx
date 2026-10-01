"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeEditor } from "./code-editor";

/** The strip above the editor: the file's path and kind, and anything to the right of them. */
function Bar({ label, kind, children }: { label: string; kind: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
      <span className="truncate font-mono text-foreground">{label}</span>
      <span>{kind}</span>
      {children}
    </div>
  );
}

/** An editor for one file of a skill, with a rendered preview for markdown files. */
export function MarkdownEditor({ value, onChange, label, isMarkdown = true }: { value: string; onChange: (value: string) => void; label: string; isMarkdown?: boolean }) {
  const editor = <CodeEditor value={value} onChange={onChange} label={label} isMarkdown={isMarkdown} />;
  if (!isMarkdown)
    return (
      <div className="flex flex-col">
        <Bar label={label} kind="Text" />
        {editor}
      </div>
    );
  return (
    <Tabs defaultValue="edit" className="gap-0">
      <Bar label={label} kind="Markdown">
        <TabsList className="ml-auto h-7 p-0.5">
          <TabsTrigger value="edit" className="px-2 text-xs">
            Edit
          </TabsTrigger>
          <TabsTrigger value="preview" className="px-2 text-xs">
            Preview
          </TabsTrigger>
        </TabsList>
      </Bar>
      <TabsContent value="edit">{editor}</TabsContent>
      <TabsContent value="preview">
        <article className="prose prose-sm max-w-none px-4 py-3.5 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || "_Nothing to preview._"}</ReactMarkdown>
        </article>
      </TabsContent>
    </Tabs>
  );
}
