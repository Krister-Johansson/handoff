"use client";

import { useActionState, useState } from "react";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { stringify } from "yaml";
import { saveSkill, type FormState } from "@/app/library/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "./markdown-editor";

export type SkillDraft = {
  name: string;
  description: string;
  body: string;
  frontmatter: Record<string, unknown>;
  files: { path: string; content: string; encoding?: "base64" }[];
};

const SKILL_MD = "SKILL.md";
const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
const yamlOf = (data: Record<string, unknown>) => (Object.keys(data).length ? stringify(data, { lineWidth: 0 }) : "");

/** SKILL.md and the supporting files, with a field to add a file by path. */
function FileList({
  paths,
  open,
  onOpen,
  onAdd,
  onRemove,
  error,
}: {
  paths: string[];
  open: string;
  onOpen: (path: string) => void;
  onAdd: (path: string) => boolean;
  onRemove: (path: string) => void;
  error: string | undefined;
}) {
  const [newPath, setNewPath] = useState("");
  const add = () => {
    if (onAdd(newPath.trim())) setNewPath("");
  };
  return (
    <nav aria-label="Files" className="flex flex-col gap-1">
      {paths.map((path) => (
        <div key={path} className="group flex items-center gap-1">
          <Button type="button" variant={open === path ? "secondary" : "ghost"} size="sm" className="min-w-0 flex-1 justify-start font-mono text-xs" onClick={() => onOpen(path)}>
            <FileTextIcon data-icon="inline-start" />
            <span className="truncate">{path}</span>
          </Button>
          {path !== SKILL_MD && (
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${path}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(path)}>
              <XIcon />
            </Button>
          )}
        </div>
      ))}
      <div className="mt-2 flex gap-1">
        <Input
          aria-label="New file path"
          placeholder="examples/basic.md"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-8 font-mono text-xs"
        />
        <Button type="button" size="icon-sm" variant="outline" aria-label="Add file" onClick={add}>
          <PlusIcon />
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </nav>
  );
}

function FrontmatterField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error: string | undefined }) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="skill-frontmatter">Other frontmatter</FieldLabel>
      <Textarea
        id="skill-frontmatter"
        name="frontmatter"
        rows={3}
        placeholder={"license: MIT\nallowed-tools: Read, Grep"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
      />
      <FieldDescription>YAML keys written into SKILL.md next to name and description, such as license or allowed-tools.</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function HeaderFields({ isNew, state, description, onDescription }: { isNew: boolean; state: FormState; description: string; onDescription: (value: string) => void }) {
  const nameError = state.errors?.name;
  const descriptionError = state.errors?.description;
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      {isNew && (
        <Field data-invalid={nameError ? true : undefined}>
          <FieldLabel htmlFor="skill-name">Name</FieldLabel>
          <Input id="skill-name" name="name" placeholder="ci-triage" defaultValue={state.values?.name} className="font-mono" />
          {nameError && <FieldError>{nameError}</FieldError>}
        </Field>
      )}
      <Field data-invalid={descriptionError ? true : undefined} className={cn(!isNew && "md:col-span-2")}>
        <FieldLabel htmlFor="skill-description">Description</FieldLabel>
        <Input id="skill-description" name="description" value={description} onChange={(e) => onDescription(e.target.value)} />
        <FieldDescription>When Claude should use this skill. It decides from this line.</FieldDescription>
        {descriptionError && <FieldError>{descriptionError}</FieldError>}
      </Field>
    </FieldGroup>
  );
}

/**
 * The whole skill folder: name, description, SKILL.md instructions and supporting files, each file in
 * the markdown editor. Without `skill` it creates a new skill.
 */
export function SkillEditor({ skill }: { skill?: SkillDraft }) {
  const [state, action, pending] = useActionState(saveSkill, {} as FormState);
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [frontmatter, setFrontmatter] = useState(() => yamlOf(skill?.frontmatter ?? {}));
  const [files, setFiles] = useState(skill?.files ?? []);
  const [open, setOpen] = useState(SKILL_MD);
  const error = (field: string) => state.errors?.[field];

  const current = open === SKILL_MD ? undefined : files.find((f) => f.path === open);
  const addFile = (path: string) => {
    if (!path || path === SKILL_MD || files.some((f) => f.path === path)) return false;
    setFiles([...files, { path, content: "" }]);
    setOpen(path);
    return true;
  };
  const removeFile = (path: string) => {
    setFiles(files.filter((f) => f.path !== path));
    if (open === path) setOpen(SKILL_MD);
  };

  return (
    <form action={action} className="flex flex-col gap-6">
      {skill ? <input type="hidden" name="name" value={skill.name} /> : <input type="hidden" name="$new" value="1" />}
      <input type="hidden" name="body" value={body} />
      <input type="hidden" name="files" value={JSON.stringify(files)} />
      <HeaderFields isNew={!skill} state={state} description={description} onDescription={setDescription} />

      <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <FileList
          paths={[SKILL_MD, ...files.map((f) => f.path)]}
          open={open}
          onOpen={setOpen}
          onAdd={addFile}
          onRemove={removeFile}
          error={error("files")}
        />

        <div className="flex min-w-0 flex-col gap-2">
          {current?.encoding === "base64" ? (
            <p className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
              <span className="font-mono">{current.path}</span> is a binary file ({Math.round((current.content.length * 3) / 4 / 1024)} KB). It is staged with the skill as it is.
            </p>
          ) : current ? (
            <MarkdownEditor
              key={current.path}
              label={current.path}
              isMarkdown={isMarkdown(current.path)}
              value={current.content}
              onChange={(content) => setFiles(files.map((f) => (f.path === current.path ? { ...f, content } : f)))}
            />
          ) : (
            <MarkdownEditor key={SKILL_MD} label={SKILL_MD} value={body} onChange={setBody} />
          )}
          {open === SKILL_MD && error("body") && <FieldError>{error("body")}</FieldError>}
        </div>
      </div>

      <FrontmatterField value={frontmatter} onChange={setFrontmatter} error={error("frontmatter")} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save skill
        </Button>
        {state.ok && state.message && <span className="text-sm text-muted-foreground">{state.message}</span>}
      </div>
    </form>
  );
}
