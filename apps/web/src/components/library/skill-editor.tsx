"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { FileCodeIcon, FileTextIcon, PlusIcon, SaveIcon, XIcon } from "lucide-react";
import { stringify } from "yaml";
import { saveSkill, type FormState } from "@/app/library/actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DeleteEntryButton } from "./delete-entry-button";
import type { EntryHeader } from "@/lib/library-entry-header";
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
    <nav aria-label="Files" className="flex flex-col gap-0.5 border-b p-2.5 md:border-r md:border-b-0">
      <h3 className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">Files</h3>
      {paths.map((path) => {
        const Icon = isMarkdown(path) ? FileTextIcon : FileCodeIcon;
        return (
          <div key={path} className="group flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("min-w-0 flex-1 justify-start rounded-md font-mono text-xs font-normal text-muted-foreground hover:text-foreground", open === path && "bg-muted text-foreground")}
              onClick={() => onOpen(path)}
            >
              <Icon data-icon="inline-start" />
              <span className="truncate">{path}</span>
            </Button>
            {path !== SKILL_MD && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${path}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(path)}>
                <XIcon />
              </Button>
            )}
          </div>
        );
      })}
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
          className="h-7 rounded-md font-mono text-xs"
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

function HeaderFields({ name, state, description, onDescription }: { name: string | undefined; state: FormState; description: string; onDescription: (value: string) => void }) {
  const nameError = state.errors?.name;
  const descriptionError = state.errors?.description;
  return (
    <>
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor="skill-name">Name</FieldLabel>
        {name === undefined ? (
          <Input id="skill-name" name="name" placeholder="ci-triage" defaultValue={state.values?.name} className="font-mono" />
        ) : (
          <Input id="skill-name" value={name} disabled className="font-mono" />
        )}
        <FieldDescription>Nodes enable the skill by this name.</FieldDescription>
        {nameError && <FieldError>{nameError}</FieldError>}
      </Field>
      <Field data-invalid={descriptionError ? true : undefined}>
        <FieldLabel htmlFor="skill-description">Description</FieldLabel>
        <Input id="skill-description" name="description" value={description} onChange={(e) => onDescription(e.target.value)} />
        <FieldDescription>When Claude should use this skill. It decides from this line.</FieldDescription>
        {descriptionError && <FieldError>{descriptionError}</FieldError>}
      </Field>
    </>
  );
}

type SkillFile = SkillDraft["files"][number];

/** The open file: SKILL.md or a supporting file in the editor, or a note for a binary file, which is kept as it is. */
function FilePane({ current, body, onBody, onFile, error }: { current: SkillFile | undefined; body: string; onBody: (body: string) => void; onFile: (content: string) => void; error: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col">
      {current?.encoding === "base64" ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          <span className="font-mono">{current.path}</span> is a binary file ({Math.round((current.content.length * 3) / 4 / 1024)} KB). It is staged with the skill as it is.
        </p>
      ) : current ? (
        <MarkdownEditor key={current.path} label={current.path} isMarkdown={isMarkdown(current.path)} value={current.content} onChange={onFile} />
      ) : (
        <MarkdownEditor key={SKILL_MD} label={SKILL_MD} value={body} onChange={onBody} />
      )}
      {error && <FieldError className="px-4 pb-3">{error}</FieldError>}
    </div>
  );
}

/** The header's buttons: Delete and Discard changes for a saved skill, and Save, which submits the form below. */
function EditorActions({
  formId,
  name,
  version,
  changed,
  pending,
  message,
  onDiscard,
}: {
  formId: string;
  name: string | undefined;
  version: number | undefined;
  changed: boolean;
  pending: boolean;
  message: string | undefined;
  onDiscard: () => void;
}) {
  return (
    <>
      {message && !changed && (
        <span role="status" className="text-[13px] text-muted-foreground">
          {message}
        </span>
      )}
      {name && <DeleteEntryButton kind="skill" name={name} />}
      {name && (
        <Button type="button" variant="outline" disabled={!changed || pending} onClick={onDiscard}>
          Discard changes
        </Button>
      )}
      <Button type="submit" form={formId} disabled={pending}>
        <SaveIcon data-icon="inline-start" />
        {name && version !== undefined ? `Save as v${version + 1}` : "Save skill"}
      </Button>
    </>
  );
}

/**
 * The whole skill folder: name, description, SKILL.md instructions and supporting files, each file in
 * the markdown editor, under the page header that holds Save, Discard changes and Delete. Without
 * `skill` it creates a new skill. `children` sit between the header and the form, such as where an
 * imported skill came from.
 */
export function SkillEditor({ header, skill, version, children }: { header: EntryHeader; skill?: SkillDraft; version?: number; children?: ReactNode }) {
  const formId = useId();
  const [state, action, pending] = useActionState(saveSkill, {} as FormState);
  const saved = { description: skill?.description ?? "", body: skill?.body ?? "", frontmatter: yamlOf(skill?.frontmatter ?? {}), files: skill?.files ?? [] };
  const [description, setDescription] = useState(saved.description);
  const [body, setBody] = useState(saved.body);
  const [frontmatter, setFrontmatter] = useState(saved.frontmatter);
  const [files, setFiles] = useState(saved.files);
  const [open, setOpen] = useState(SKILL_MD);
  const error = (field: string) => state.errors?.[field];
  const changed = description !== saved.description || body !== saved.body || frontmatter !== saved.frontmatter || JSON.stringify(files) !== JSON.stringify(saved.files);
  const discard = () => {
    setDescription(saved.description);
    setBody(saved.body);
    setFrontmatter(saved.frontmatter);
    setFiles(saved.files);
    setOpen(SKILL_MD);
  };

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
    <>
      <PageHeader
        {...header}
        actions={<EditorActions formId={formId} name={skill?.name} version={version} changed={changed} pending={pending} message={state.ok ? state.message : undefined} onDiscard={discard} />}
      />
      {children}
      <form id={formId} action={action} className="flex flex-col gap-6">
        {skill ? <input type="hidden" name="name" value={skill.name} /> : <input type="hidden" name="$new" value="1" />}
        <input type="hidden" name="body" value={body} />
        <input type="hidden" name="files" value={JSON.stringify(files)} />
        <Card className="px-5 py-4">
          <FieldGroup className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <HeaderFields name={skill?.name} state={state} description={description} onDescription={setDescription} />
            <div className="md:col-span-2">
              <FrontmatterField value={frontmatter} onChange={setFrontmatter} error={error("frontmatter")} />
            </div>
          </FieldGroup>
        </Card>

        <Card className="grid gap-0 py-0 md:min-h-[520px] md:grid-cols-[220px_minmax(0,1fr)]">
          <FileList paths={[SKILL_MD, ...files.map((f) => f.path)]} open={open} onOpen={setOpen} onAdd={addFile} onRemove={removeFile} error={error("files")} />

          <FilePane current={current} body={body} onBody={setBody} onFile={(content) => current && setFiles(files.map((f) => (f.path === current.path ? { ...f, content } : f)))} error={open === SKILL_MD ? error("body") : undefined} />
        </Card>
      </form>
    </>
  );
}
