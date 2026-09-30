"use client";

import { useState, type Dispatch } from "react";
import { TrashIcon } from "lucide-react";
import { CONDITION_PRESETS } from "@/lib/condition-presets";
import { ConditionSchema, nodeCatalog, type DeterministicCheck, type FlowEdge, type FlowGraph, type FlowNode, type NodeType } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { EditorAction } from "./state";

export type LibraryNames = { skills: string[]; mcp: string[]; agents: string[] };

const CLI_TYPES = new Set<NodeType>(["planner", "coder", "reviewer"]);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function LibraryPicker({ node, library, dispatch }: { node: FlowNode; library: LibraryNames; dispatch: Dispatch<EditorAction> }) {
  const selected = { skills: node.data.library?.skills ?? [], mcp: node.data.library?.mcp ?? [], agents: node.data.library?.agents ?? [] };
  const groups = [
    { key: "skills" as const, legend: "Skills" },
    { key: "mcp" as const, legend: "MCP servers" },
    { key: "agents" as const, legend: "Subagents" },
  ];
  const toggle = (group: keyof LibraryNames, name: string, on: boolean) => {
    const next = { ...selected, [group]: on ? [...selected[group], name] : selected[group].filter((n) => n !== name) };
    dispatch({ type: "updateNode", id: node.id, patch: { library: next } });
  };
  return (
    <>
      {groups.map((group) => (
        <FieldSet key={group.key}>
          <FieldLegend variant="label">{group.legend}</FieldLegend>
          {library[group.key].length === 0 ? (
            <FieldDescription>None in the library yet.</FieldDescription>
          ) : (
            <FieldGroup data-slot="checkbox-group">
              {library[group.key].map((name) => (
                <Field key={name} orientation="horizontal">
                  <Checkbox
                    id={`lib-${group.key}-${name}`}
                    checked={selected[group.key].includes(name)}
                    onCheckedChange={(on) => toggle(group.key, name, on === true)}
                  />
                  <FieldLabel htmlFor={`lib-${group.key}-${name}`} className="font-mono text-xs font-normal">
                    {name}
                  </FieldLabel>
                </Field>
              ))}
            </FieldGroup>
          )}
        </FieldSet>
      ))}
    </>
  );
}

function ContractChecks({ node, dispatch }: { node: FlowNode; dispatch: Dispatch<EditorAction> }) {
  const output = node.data.contract?.output ?? nodeCatalog[node.data.nodeType as NodeType].contract;
  const checks: DeterministicCheck[] = (node.data.contract?.checks as DeterministicCheck[] | undefined) ?? [];
  const tests = checks.find((c) => c.kind === "tests_green");
  const diff = checks.some((c) => c.kind === "diff_within_paths");
  const write = (next: DeterministicCheck[]) => dispatch({ type: "updateNode", id: node.id, patch: { contract: { output, checks: next } } });
  const without = (kind: DeterministicCheck["kind"]) => checks.filter((c) => c.kind !== kind);
  return (
    <FieldSet>
      <FieldLegend variant="label">Checks before passing</FieldLegend>
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox id="check-diff" checked={diff} onCheckedChange={(on) => write(on === true ? [...without("diff_within_paths"), { kind: "diff_within_paths" }] : without("diff_within_paths"))} />
          <FieldContent>
            <FieldLabel htmlFor="check-diff" className="font-normal">
              Changes stay within the plan&apos;s owned paths
            </FieldLabel>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="check-tests">Tests must pass</FieldLabel>
          <Input
            id="check-tests"
            placeholder="npm test"
            defaultValue={tests?.command ?? ""}
            onBlur={(e) => {
              const command = e.target.value.trim();
              write(command ? [...without("tests_green"), { kind: "tests_green", command, timeoutMs: 600_000 }] : without("tests_green"));
            }}
          />
          <FieldDescription>Runs in the worktree after the node finishes. Leave empty to skip.</FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}

function KeyField({ node, dispatch, onSelect }: { node: FlowNode; dispatch: Dispatch<EditorAction>; onSelect: (nodeId: string) => void }) {
  const [key, setKey] = useState(node.id);
  const valid = /^[A-Za-z0-9_-]+$/.test(key);
  return (
    <Field data-invalid={valid ? undefined : true}>
      <FieldLabel htmlFor="node-key">Key</FieldLabel>
      <div className="flex gap-2">
        <Input id="node-key" className="font-mono text-xs" value={key} aria-invalid={valid ? undefined : true} onChange={(e) => setKey(e.target.value)} />
        <Button
          variant="outline"
          size="sm"
          disabled={!valid || key === node.id}
          onClick={() => {
            dispatch({ type: "renameNode", id: node.id, to: key });
            onSelect(key);
          }}
        >
          Rename
        </Button>
      </div>
      <FieldDescription>Used in edge keys, conditions and run state. Letters, digits, dashes and underscores.</FieldDescription>
    </Field>
  );
}

function NodeInspector({
  node,
  graph,
  library,
  dispatch,
  onSelect,
}: {
  node: FlowNode;
  graph: FlowGraph;
  library: LibraryNames;
  dispatch: Dispatch<EditorAction>;
  onSelect: (nodeId: string) => void;
}) {
  const type = node.data.nodeType as NodeType;
  const config = node.data.config;
  const setConfig = (patch: Record<string, unknown>) => dispatch({ type: "updateNode", id: node.id, patch: { config: patch } });
  const clearConfig = (key: string) => {
    dispatch({ type: "replaceNodeConfig", id: node.id, config: Object.fromEntries(Object.entries(config).filter(([k]) => k !== key)) });
  };
  const gates = graph.nodes.filter((n) => n.data.nodeType === "human_gate");
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="node-label">Label</FieldLabel>
        <Input id="node-label" value={node.data.label} onChange={(e) => dispatch({ type: "updateNode", id: node.id, patch: { label: e.target.value } })} />
        <FieldDescription className="font-mono text-xs">
          {type} · runs on {nodeCatalog[type].executorKind}
        </FieldDescription>
      </Field>
      <KeyField node={node} dispatch={dispatch} onSelect={onSelect} />
      {!node.data.isStart && (
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: "setStart", id: node.id })}>
          Make this the start node
        </Button>
      )}

      {CLI_TYPES.has(type) && (
        <>
          <Field>
            <FieldLabel htmlFor="node-turns">Max turns</FieldLabel>
            <Input
              id="node-turns"
              type="number"
              min={1}
              value={num(config.maxTurns)}
              placeholder="60"
              onChange={(e) => (e.target.value ? setConfig({ maxTurns: Number(e.target.value) }) : clearConfig("maxTurns"))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="node-tools">Allowed tools</FieldLabel>
            <Textarea
              id="node-tools"
              rows={3}
              className="font-mono text-xs"
              placeholder={nodeCatalog[type].allowedTools.join(", ")}
              defaultValue={Array.isArray(config.allowedTools) ? (config.allowedTools as string[]).join(", ") : ""}
              onBlur={(e) => (e.target.value.trim() ? setConfig({ allowedTools: csv(e.target.value) }) : clearConfig("allowedTools"))}
            />
            <FieldDescription>Comma separated, in --allowedTools syntax. Empty uses the defaults shown.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="node-feedback"
              checked={node.data.contextSelector?.includeFeedback ?? false}
              onCheckedChange={(on) =>
                dispatch({
                  type: "updateNode",
                  id: node.id,
                  patch: { contextSelector: { stateKeys: [], repoPaths: [], includePriorAttempt: true, ...node.data.contextSelector, includeFeedback: on } },
                })
              }
            />
            <FieldLabel htmlFor="node-feedback" className="font-normal">
              Include PR feedback in context
            </FieldLabel>
          </Field>
          {type === "coder" && <ContractChecks node={node} dispatch={dispatch} />}
          <LibraryPicker node={node} library={library} dispatch={dispatch} />
        </>
      )}

      {type === "tester" && (
        <Field>
          <FieldLabel htmlFor="node-command">Command</FieldLabel>
          <Input id="node-command" className="font-mono text-xs" value={str(config.command)} placeholder="npm test" onChange={(e) => setConfig({ command: e.target.value })} />
          <FieldDescription>Runs in the worktree. Exit 0 means passed.</FieldDescription>
        </Field>
      )}

      {type === "pr" && (
        <>
          <Field orientation="horizontal">
            <Switch id="pr-checks" checked={config.requireChecks !== false} onCheckedChange={(on) => setConfig({ requireChecks: on })} />
            <FieldLabel htmlFor="pr-checks" className="font-normal">
              Wait for CI checks
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch id="pr-approval" checked={config.requireApproval === true} onCheckedChange={(on) => setConfig({ requireApproval: on })} />
            <FieldLabel htmlFor="pr-approval" className="font-normal">
              Wait for an approving review
            </FieldLabel>
          </Field>
        </>
      )}

      {type === "merge" && (
        <Field>
          <FieldLabel htmlFor="merge-method">Merge method</FieldLabel>
          <NativeSelect id="merge-method" value={str(config.method) || "squash"} onChange={(e) => setConfig({ method: e.target.value })}>
            <NativeSelectOption value="squash">Squash</NativeSelectOption>
            <NativeSelectOption value="merge">Merge commit</NativeSelectOption>
            <NativeSelectOption value="rebase">Rebase</NativeSelectOption>
          </NativeSelect>
        </Field>
      )}

      {type === "human_gate" && (
        <>
          <Field>
            <FieldLabel htmlFor="gate-question">Question</FieldLabel>
            <Textarea id="gate-question" rows={3} defaultValue={str(config.question)} onBlur={(e) => (e.target.value.trim() ? setConfig({ question: e.target.value.trim() }) : clearConfig("question"))} />
            <FieldDescription>Used when the gate is not answering a node&apos;s own question or an exhausted loop.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="gate-options">Options</FieldLabel>
            <Input
              id="gate-options"
              placeholder="approve, reject"
              defaultValue={Array.isArray(config.options) ? (config.options as string[]).join(", ") : ""}
              onBlur={(e) => (e.target.value.trim() ? setConfig({ options: csv(e.target.value) }) : clearConfig("options"))}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="gate-exhausted"
              checked={graph.attributes.exhaustedGate === node.id}
              onCheckedChange={(on) => dispatch({ type: "setExhaustedGate", id: on ? node.id : undefined })}
            />
            <FieldLabel htmlFor="gate-exhausted" className="font-normal">
              Ask here when a loop runs out of attempts
            </FieldLabel>
          </Field>
        </>
      )}
      {gates.length === 0 && CLI_TYPES.has(type) && (
        <FieldDescription>Tip: add a Human gate so a node can ask you questions with status needs_input.</FieldDescription>
      )}
      <Button variant="destructive" size="sm" onClick={() => dispatch({ type: "remove", ids: [node.id] })}>
        <TrashIcon data-icon="inline-start" />
        Delete node
      </Button>
    </FieldGroup>
  );
}

function ConditionField({ edge, dispatch }: { edge: FlowEdge; dispatch: Dispatch<EditorAction> }) {
  const [text, setText] = useState(edge.data.condition ? JSON.stringify(edge.data.condition, null, 2) : "");
  const [error, setError] = useState<string | undefined>();
  const apply = (value: string) => {
    if (!value.trim()) {
      setError(undefined);
      dispatch({ type: "updateEdge", id: edge.id, patch: { condition: undefined } });
      return;
    }
    try {
      const parsed = ConditionSchema.safeParse(JSON.parse(value));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid condition");
      setError(undefined);
      dispatch({ type: "updateEdge", id: edge.id, patch: { condition: parsed.data } });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="edge-condition">Condition</FieldLabel>
      <Textarea
        id="edge-condition"
        rows={6}
        className="font-mono text-xs"
        placeholder={'{ "eq": ["node.output.status", "done"] }'}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => apply(e.target.value)}
      />
      <FieldDescription>JSON predicate over state., node. and edge. paths. Empty means always.</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function EdgeInspector({ edge, graph, dispatch }: { edge: FlowEdge; graph: FlowGraph; dispatch: Dispatch<EditorAction> }) {
  const gates = graph.nodes.filter((n) => n.data.nodeType === "human_gate");
  return (
    <FieldGroup>
      <FieldDescription className="font-mono text-xs">
        {edge.source} to {edge.target}
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="edge-on">Follow when the source</FieldLabel>
        <NativeSelect id="edge-on" value={edge.data.on} onChange={(e) => dispatch({ type: "updateEdge", id: edge.id, patch: { on: e.target.value as "passed" | "failed" | "any" } })}>
          <NativeSelectOption value="passed">passed</NativeSelectOption>
          <NativeSelectOption value="failed">failed</NativeSelectOption>
          <NativeSelectOption value="any">finished either way</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="edge-preset">Preset</FieldLabel>
        <NativeSelect
          id="edge-preset"
          value=""
          onChange={(e) => {
            const preset = CONDITION_PRESETS.find((p) => p.label === e.target.value);
            if (preset) dispatch({ type: "updateEdge", id: edge.id, patch: { condition: preset.condition } });
          }}
        >
          <NativeSelectOption value="">Pick a common condition</NativeSelectOption>
          {CONDITION_PRESETS.map((p) => (
            <NativeSelectOption key={p.label} value={p.label}>
              {p.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <ConditionField key={`${edge.id}:${JSON.stringify(edge.data.condition ?? null)}`} edge={edge} dispatch={dispatch} />
      <Field orientation="horizontal">
        <Switch
          id="edge-loop"
          checked={edge.data.loop}
          onCheckedChange={(on) => dispatch({ type: "updateEdge", id: edge.id, patch: on ? { loop: true, maxAttempts: edge.data.maxAttempts ?? 3 } : { loop: false, maxAttempts: undefined, onExhausted: undefined } })}
        />
        <FieldContent>
          <FieldLabel htmlFor="edge-loop" className="font-normal">
            Loop back
          </FieldLabel>
          <FieldDescription>Allows a cycle through this edge, bounded by max attempts.</FieldDescription>
        </FieldContent>
      </Field>
      {edge.data.loop && (
        <>
          <Field>
            <FieldLabel htmlFor="edge-attempts">Max attempts</FieldLabel>
            <Input
              id="edge-attempts"
              type="number"
              min={1}
              value={num(edge.data.maxAttempts)}
              onChange={(e) => dispatch({ type: "updateEdge", id: edge.id, patch: { maxAttempts: e.target.value ? Number(e.target.value) : undefined } })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edge-exhausted">When attempts run out</FieldLabel>
            <NativeSelect
              id="edge-exhausted"
              value={edge.data.onExhausted ?? ""}
              onChange={(e) => dispatch({ type: "updateEdge", id: edge.id, patch: { onExhausted: e.target.value || undefined } })}
            >
              <NativeSelectOption value="">Use the graph&apos;s exhaustion gate, or fail the run</NativeSelectOption>
              {gates.map((g) => (
                <NativeSelectOption key={g.id} value={g.id}>
                  Ask at {g.data.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
      <Button variant="destructive" size="sm" onClick={() => dispatch({ type: "remove", ids: [edge.id] })}>
        <TrashIcon data-icon="inline-start" />
        Delete edge
      </Button>
    </FieldGroup>
  );
}

export function Inspector({
  graph,
  selection,
  library,
  dispatch,
  onSelect,
}: {
  graph: FlowGraph;
  selection: { nodeId?: string; edgeId?: string };
  library: LibraryNames;
  dispatch: Dispatch<EditorAction>;
  onSelect: (nodeId: string) => void;
}) {
  const node = selection.nodeId ? graph.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const edge = selection.edgeId ? graph.edges.find((e) => e.id === selection.edgeId) : undefined;
  if (node) return <NodeInspector key={node.id} node={node} graph={graph} library={library} dispatch={dispatch} onSelect={onSelect} />;
  if (edge) return <EdgeInspector key={edge.id} edge={edge} graph={graph} dispatch={dispatch} />;
  return <FieldDescription>Select a node or an edge to edit it. Drag from a node&apos;s right handle to another node to connect them. Press Backspace to delete the selection.</FieldDescription>;
}
