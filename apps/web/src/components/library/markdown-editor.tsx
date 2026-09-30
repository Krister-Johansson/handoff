"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeEditor } from "./code-editor";


/** An editor for one file of a skill, with a rendered preview for markdown files. */
export function MarkdownEditor({ value, onChange, label, isMarkdown = true }: { value: string; onChange: (value: string) => void; label: string; isMarkdown?: boolean }) {
  const editor = <CodeEditor value={value} onChange={onChange} label={label} isMarkdown={isMarkdown} />;
  if (!isMarkdown) return editor;
  return (
    <Tabs defaultValue="edit" className="gap-2">
      <TabsList>
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="edit">{editor}</TabsContent>
      <TabsContent value="preview">
        <article className="prose prose-sm max-w-none rounded-md border p-4 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || "_Nothing to preview._"}</ReactMarkdown>
        </article>
      </TabsContent>
    </Tabs>
  );
}
