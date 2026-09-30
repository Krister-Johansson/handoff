"use client";

import { useState, type Dispatch } from "react";
import { TrashIcon } from "lucide-react";
import { CONDITION_PRESETS } from "@/lib/condition-presets";
import { ConditionSchema, EFFORT_LEVELS, gateMode, MODEL_ALIASES, nodeCatalog, type DeterministicCheck, type FlowEdge, type FlowGraph, type FlowNode, type NodeType } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ChosenLibrary, LibraryChooser } from "@/components/library/library-chooser";
import type { LibraryChoices } from "@/lib/library-choices";
import { PassEnvField } from "./pass-env-field";
import type { EditorAction } from "./state";


const CLI_TYPES = new Set<NodeType>(["planner", "coder", "reviewer"]);

const INSTRUCTION_HINTS: Partial<Record<NodeType, string>> = {
  planner: "Plan in small steps; name the files each step touches.",
  coder: "Follow the repository's lint rules; keep commits small.",
  reviewer: "Review the plan, not code: is it complete, ordered and testable?",
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** The node's skills, MCP servers, agents and groups: badges, and a dialog to choose them. */
function LibraryPicker({ node, library, dispatch }: { node: FlowNode; library: LibraryChoices; dispatch: Dispatch<EditorAction> }) {
  const selected = {
    skills: node.data.library?.skills ?? [],
    mcp: node.data.library?.mcp ?? [],
    agents: node.data.library?.agents ?? [],
    groups: node.data.library?.groups ?? [],
  };
  const set = (library: typeof selected) => dispatch({ type: "updateNode", id: node.id, patch: { library } });
  return (
    <Field>
      <FieldLabel>Library</FieldLabel>
      <ChosenLibrary selection={selected} empty="Nothing enabled here." onRemove={(kind, name) => set({ ...selected, [kind]: selected[kind].filter((n) => n !== name) })} />
      <div>
        <LibraryChooser
          available={library}
          initial={selected}
          title={`Library for ${node.data.label}`}
          description="Skills, MCP servers, agents and groups this step gets, on top of the project's default library."
          onSave={(chosen) => {
            set(chosen);
            return true;
          }}
        />
      </div>
    </Field>
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
              write(
                command
                  ? [...without("tests_green"), { kind: "tests_green", command, timeoutMs: 600_000, ...(tests?.passEnv ? { passEnv: tests.passEnv } : {}) }]
                  : without("tests_green"),
              );
            }}
          />
          <FieldDescription>Runs in the worktree after the node finishes. Leave empty to skip.</FieldDescription>
        </Field>
        {tests && (
          <PassEnvField id="check-tests-env" value={tests.passEnv ?? []} onChange={(passEnv) => write([...without("tests_green"), { ...tests, passEnv }])} />
        )}
      </FieldGroup>
    </FieldSet>
  );
}

function TesterSettings({ config, setConfig }: { config: Record<string, unknown>; setConfig: (patch: Record<string, unknown>) => void }) {
  const passEnv = Array.isArray(config.passEnv) ? config.passEnv.filter((n): n is string => typeof n === "string") : [];
  return (
    <>
      <Field>
        <FieldLabel htmlFor="node-command">Command</FieldLabel>
        <Input id="node-command" className="font-mono text-xs" value={str(config.command)} placeholder="npm test" onChange={(e) => setConfig({ command: e.target.value })} />
        <FieldDescription>Runs in the worktree. Exit 0 means passed.</FieldDescription>
      </Field>
      <PassEnvField id="node-pass-env" value={passEnv} onChange={(names) => setConfig({ passEnv: names })} />
    </>
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
  library: LibraryChoices;
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
          <ModelFields config={config} setConfig={setConfig} clearConfig={clearConfig} />
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
          <Field>
            <FieldLabel htmlFor="node-instructions">Instructions</FieldLabel>
            <Textarea
              id="node-instructions"
              rows={5}
              placeholder={INSTRUCTION_HINTS[type]}
              defaultValue={str(config.instructions)}
              onBlur={(e) => (e.target.value.trim() ? setConfig({ instructions: e.target.value.trim() }) : clearConfig("instructions"))}
            />
            <FieldDescription>Markdown added to this step&apos;s built-in role. What reaches the feedback input comes along on its own.</FieldDescription>
          </Field>
          {type === "coder" && <ContractChecks node={node} dispatch={dispatch} />}
          <LibraryPicker node={node} library={library} dispatch={dispatch} />
        </>
      )}

      {type === "tester" && <TesterSettings config={config} setConfig={setConfig} />}

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
            <FieldLabel htmlFor="gate-mode">Mode</FieldLabel>
            <NativeSelect id="gate-mode" value={gateMode(config)} onChange={(e) => setConfig({ mode: e.target.value })}>
              <NativeSelectOption value="approval">Review and approve what reaches it</NativeSelectOption>
              <NativeSelectOption value="question">Answer a question a coder asked</NativeSelectOption>
            </NativeSelect>
            <FieldDescription>
              {gateMode(config) === "approval"
                ? "You review the output that reaches in, comment on it, then approve or ask for changes."
                : "The coder's question is asked; the answer goes back on answered."}
            </FieldDescription>
          </Field>
          {gateMode(config) === "approval" && (
            <Field>
              <FieldLabel htmlFor="gate-question">Question</FieldLabel>
              <Textarea
                id="gate-question"
                rows={2}
                placeholder="Review the plan from planner-1"
                defaultValue={str(config.question)}
                onBlur={(e) => (e.target.value.trim() ? setConfig({ question: e.target.value.trim() }) : clearConfig("question"))}
              />
            </Field>
          )}
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

const isAlias = (model: string) => MODEL_ALIASES.some((m) => m.alias === model);

/** Which model and how much effort a CLI step runs with; empty keeps the worker's HANDOFF_MODEL and HANDOFF_EFFORT. */
function ModelFields({ config, setConfig, clearConfig }: { config: Record<string, unknown>; setConfig: (patch: Record<string, unknown>) => void; clearConfig: (key: string) => void }) {
  const model = str(config.model);
  const [custom, setCustom] = useState(model !== "" && !isAlias(model));
  const choice = custom ? "custom" : model;
  return (
    <>
      <Field>
        <FieldLabel htmlFor="node-model">Model</FieldLabel>
        <NativeSelect
          id="node-model"
          value={choice}
          onChange={(e) => {
            const value = e.target.value;
            setCustom(value === "custom");
            if (value === "custom") return;
            if (value) setConfig({ model: value });
            else clearConfig("model");
          }}
        >
          <NativeSelectOption value="">Worker default</NativeSelectOption>
          {MODEL_ALIASES.map((m) => (
            <NativeSelectOption key={m.alias} value={m.alias}>
              {m.alias}: {m.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="custom">A model id…</NativeSelectOption>
        </NativeSelect>
        {custom && (
          <Input
            aria-label="Model id"
            className="font-mono text-xs"
            placeholder="claude-opus-5-5"
            defaultValue={isAlias(model) ? "" : model}
            onBlur={(e) => (e.target.value.trim() ? setConfig({ model: e.target.value.trim() }) : clearConfig("model"))}
          />
        )}
        <FieldDescription>Aliases follow the newest model of each family on your account.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="node-effort">Effort</FieldLabel>
        <NativeSelect id="node-effort" value={str(config.effort)} onChange={(e) => (e.target.value ? setConfig({ effort: e.target.value }) : clearConfig("effort"))}>
          <NativeSelectOption value="">Worker or model default</NativeSelectOption>
          {EFFORT_LEVELS.map((level) => (
            <NativeSelectOption key={level} value={level}>
              {level}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>How much the model thinks. A model without a level uses the highest one it has below it.</FieldDescription>
      </Field>
    </>
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

function LoopFields({ edge, gates, dispatch }: { edge: FlowEdge; gates: FlowNode[]; dispatch: Dispatch<EditorAction> }) {
  const feedback = edge.data.input === "feedback";
  return (
    <>
      <Field>
        <FieldLabel htmlFor="edge-attempts">Max attempts</FieldLabel>
        <Input
          id="edge-attempts"
          type="number"
          min={1}
          value={num(edge.data.maxAttempts ?? (feedback ? 3 : undefined))}
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
  );
}

/** The raw routing of an edge: when it follows, a condition, and a loop without a feedback input. */
function AdvancedEdgeFields({ edge, gates, dispatch }: { edge: FlowEdge; gates: FlowNode[]; dispatch: Dispatch<EditorAction> }) {
  return (
    <>
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
      {edge.data.input !== "feedback" && (
        <>
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
          {edge.data.loop && <LoopFields edge={edge} gates={gates} dispatch={dispatch} />}
        </>
      )}
    </>
  );
}

function EdgeInspector({ edge, graph, dispatch }: { edge: FlowEdge; graph: FlowGraph; dispatch: Dispatch<EditorAction> }) {
  const gates = graph.nodes.filter((n) => n.data.nodeType === "human_gate");
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.data.label ?? id;
  const port = edge.data.port?.replace("_", " ");
  const input = edge.data.input ?? "in";
  return (
    <FieldGroup>
      <p className="text-sm">
        {label(edge.source)}: {port ?? "custom condition"} → {label(edge.target)}: {input}
      </p>
      {input === "feedback" && (
        <>
          <FieldDescription>
            {label(edge.source)} sends its output back to {label(edge.target)}, which tries again with it as feedback.
          </FieldDescription>
          <LoopFields edge={edge} gates={gates} dispatch={dispatch} />
        </>
      )}
      <details className="flex flex-col gap-4" open={!edge.data.port}>
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <FieldGroup className="pt-3">
          <FieldDescription>
            {edge.data.port ? `A condition here replaces the ${port} port's.` : "This edge has no port, so this condition decides when it is followed."}
          </FieldDescription>
          <AdvancedEdgeFields edge={edge} gates={gates} dispatch={dispatch} />
        </FieldGroup>
      </details>
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
  library: LibraryChoices;
  dispatch: Dispatch<EditorAction>;
  onSelect: (nodeId: string) => void;
}) {
  const node = selection.nodeId ? graph.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const edge = selection.edgeId ? graph.edges.find((e) => e.id === selection.edgeId) : undefined;
  if (node) return <NodeInspector key={node.id} node={node} graph={graph} library={library} dispatch={dispatch} onSelect={onSelect} />;
  if (edge) return <EdgeInspector key={edge.id} edge={edge} graph={graph} dispatch={dispatch} />;
  return <FieldDescription>Select a node or an edge to edit it. Drag from a node&apos;s right handle to another node to connect them. Press Backspace to delete the selection.</FieldDescription>;
}
