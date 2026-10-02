"use client";

import { useFlowColorMode } from "@/lib/use-flow-color-mode";
import { canConnect } from "@/lib/connect-rules";
import { flowOf } from "@/lib/flow";
import { InvalidEdgesContext } from "./edge-issues";
import { Controls, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes, type OnSelectionChangeParams } from "@xyflow/react";
import { Fragment, useCallback, useEffect, useMemo, useReducer, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckIcon, LayoutGridIcon, MaximizeIcon } from "lucide-react";
import { type FlowEdge, type FlowNode, type NodeType } from "@handoff/core";
import { loadGraphVersionAction, saveGraphAction } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EdgeRoute, LayoutResult } from "@/lib/elk-layout";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CanvasBackground, CanvasMiniMap } from "./canvas-chrome";
import { CANVAS_STYLE, CONTROLS_CLASS, PANEL_CLASS } from "./canvas-style";
import { EdgeRoutesContext, useElkLayout, useMeasuredSignature } from "./elk-routes";
import { HandoffEdgeComponent } from "./handoff-edge";
import { HandoffNodeComponent } from "./handoff-node";
import type { LibraryChoices } from "@/lib/library-choices";
import { Inspector } from "./inspector";
import { InspectorSection } from "./inspector-section";
import { NODE_ICONS } from "./node-icons";
import { EditLockButton } from "./edit-lock";
import { VersionHistory, type VersionItem } from "./version-history";
import { changesEdit, documentOf, editorReducer, issuesOf, NODE_LABELS } from "./state";
import { useGraphPageTools, type Selection } from "./use-graph-page-tools";

const nodeTypes: NodeTypes = { handoff: HandoffNodeComponent };
const edgeTypes: EdgeTypes = { handoff: HandoffEdgeComponent };
/** The palette in two groups: the steps that do or judge the work, then the ones that ship it and close the graph. */
const PALETTE: NodeType[][] = [
  ["start", "planner", "coder", "reviewer", "code_review", "tester", "demo", "human_gate"],
  ["pr", "merge", "function", "finish"],
];

type Props = {
  projectId: string;
  graphName: string;
  version: number;
  document: unknown;
  library: LibraryChoices;
  versions: VersionItem[];
  /** The breadcrumbs, drawn above the canvas with when the shown version was saved. */
  trail?: React.ReactNode;
  runSlot?: React.ReactNode;
};

/** When and by whom the shown version was saved, or which earlier version is shown unsaved. */
function savedLine(version: number, versions: VersionItem[], restoring: number | undefined): string {
  if (restoring !== undefined) return `Showing v${restoring}, not saved yet`;
  const shown = versions.find((v) => v.version === version);
  if (!shown) return `v${version}`;
  return `v${version} saved ${formatAgo(new Date(shown.createdAt))}${shown.createdBy ? ` by ${shown.createdBy}` : ""}`;
}

function Editor({ projectId, graphName, version: initialVersion, document, library, versions: initialVersions, trail, runSlot }: Props) {
  const [graph, dispatch] = useReducer(editorReducer, document, flowOf);
  const colorMode = useFlowColorMode();
  const [selection, setSelection] = useState<Selection>({});
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [versions, setVersions] = useState(initialVersions);
  const [restoring, setRestoring] = useState<number | undefined>();
  // Every visit starts locked: no adding, deleting, connecting or moving until the lock in the canvas controls is opened.
  const [locked, setLocked] = useState(true);

  // Warn before leaving with edits that are not saved as a version.
  useEffect(() => {
    if (saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved]);

  const restore = (v: number) =>
    startTransition(async () => {
      const doc = await loadGraphVersionAction(projectId, graphName, v);
      if (!doc) return;
      dispatch({ type: "reset", graph: flowOf(doc) });
      setSelection({});
      setRestoring(v);
      setSaved(false);
    });
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const [routes, setRoutes] = useState<Record<string, EdgeRoute>>({});
  const runLayout = useElkLayout();
  const signature = useMeasuredSignature();

  // A graph saved from Tidy layout sits exactly where ELK puts it; then its routes can be restored
  // without moving anything. Edges of nodes moved since then fall back to curves in the edge component.
  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    runLayout()
      .then(({ positions, routes: next }: LayoutResult) => {
        if (cancelled) return;
        const current = new Map(getNodes().map((n) => [n.id, n.position]));
        const matches = Object.entries(positions).every(([id, p]) => {
          const at = current.get(id);
          return at !== undefined && Math.abs(at.x - Math.round(p.x)) <= 1 && Math.abs(at.y - Math.round(p.y)) <= 1;
        });
        setRoutes(matches ? next : {});
      })
      .catch(() => setRoutes({}));
    return () => {
      cancelled = true;
    };
  }, [signature, runLayout, getNodes]);

  const issues = useMemo(() => issuesOf(graph), [graph]);
  const hasStart = graph.nodes.some((n) => n.data.nodeType === "start");
  // Each node's issue messages, for its red border and badge; edges with an issue draw red.
  const nodeIssues = useMemo(() => {
    const byNode = new Map<string, string[]>();
    for (const issue of issues) if (issue.nodeKey) byNode.set(issue.nodeKey, [...(byNode.get(issue.nodeKey) ?? []), issue.message]);
    return byNode;
  }, [issues]);
  const invalidEdges = useMemo(() => new Set(issues.flatMap((i) => (i.edgeKey ? [i.edgeKey] : []))), [issues]);
  const nodes = useMemo(
    () => graph.nodes.map((n) => (nodeIssues.has(n.id) ? { ...n, data: { ...n.data, invalid: true, issues: nodeIssues.get(n.id)! } } : n)),
    [graph.nodes, nodeIssues],
  );

  const edit = useCallback((action: Parameters<typeof dispatch>[0]) => {
    dispatch(action);
    if (changesEdit(action)) setSaved(false);
  }, []);

  const tidy = () =>
    void runLayout().then(({ positions, routes: next }) => {
      const rounded = Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
      edit({ type: "applyLayout", positions: rounded });
      setRoutes(next);
      setTimeout(() => void fitView({ duration: 300 }), 50);
    });

  const onSelectionChange = useCallback(({ nodes: n, edges: e }: OnSelectionChangeParams<FlowNode, FlowEdge>) => {
    setSelection({ ...(n[0] ? { nodeId: n[0].id } : {}), ...(!n[0] && e[0] ? { edgeId: e[0].id } : {}) });
  }, []);

  const addNode = (nodeType: NodeType) => {
    if (locked) return;
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    edit({ type: "addNode", nodeType, position: { x: Math.round(center.x), y: Math.round(center.y) } });
  };

  /** Saves the graph as its next version; the error when the server refuses it. */
  const saveVersion = async (): Promise<{ version: number } | { error: string }> => {
    const result = await saveGraphAction(projectId, graphName, documentOf(graph));
    if (!result.ok) {
      const error = result.errors.map((e) => e.message).join("; ");
      setSaveError(error);
      return { error };
    }
    setVersion(result.version);
    setVersions((current) => [{ version: result.version, createdAt: new Date().toISOString(), createdBy: "dashboard" }, ...current]);
    setRestoring(undefined);
    setSaved(true);
    setSaveError(undefined);
    return { version: result.version };
  };
  const save = () =>
    startTransition(async () => {
      await saveVersion();
    });

  useGraphPageTools({ projectId, graphName, version, graph, selection, setSelection, saved, locked, issues, edit, library, saveVersion });

  const nextVersion = Math.max(version, ...versions.map((v) => v.version)) + 1;

  return (
    <EdgeRoutesContext.Provider value={routes}>
      <InvalidEdgesContext.Provider value={invalidEdges}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-2">
            <div className="min-w-0">{trail}</div>
            <p className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {/* The age is worked out on the server and again in the browser, which can differ by a minute. */}
              <span suppressHydrationWarning>{savedLine(version, versions, restoring)}</span>
              {!saved && restoring === undefined && <span>· edited, not saved</span>}
            </p>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem]">
            <div className="relative min-w-0">
              <ReactFlow<FlowNode, FlowEdge>
                colorMode={colorMode}
                style={CANVAS_STYLE}
                nodes={nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={(changes) => edit({ type: "nodesChange", changes })}
                onEdgesChange={(changes) => edit({ type: "edgesChange", changes })}
                onConnect={(c) => edit({ type: "connect", source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle })}
                // Never a node into itself. A pair that already has an edge gets that edge re-wired (see the connect action).
                isValidConnection={(c) => canConnect({ node: c.source, type: "source" }, { node: c.target, type: "target" })}
                onSelectionChange={onSelectionChange}
                fitView
                minZoom={0.15}
                nodesDraggable={!locked}
                nodesConnectable={!locked}
                deleteKeyCode={locked ? null : ["Backspace", "Delete"]}
              >
                <CanvasBackground />
                <Controls className={CONTROLS_CLASS} showInteractive={false}>
                  <EditLockButton locked={locked} onToggle={() => setLocked((l) => !l)} />
                  <VersionHistory versions={versions} version={version} restoring={restoring} pending={pending} onRestore={restore} />
                </Controls>
                <CanvasMiniMap />
                <Panel position="top-left" aria-label="Add a node" className={cn(PANEL_CLASS, "flex flex-col gap-0.5 p-1")}>
                  {PALETTE.map((group, i) => (
                    <Fragment key={group[0]}>
                      {i > 0 && <Separator className="mx-0.5 my-0.5 w-auto" />}
                      {group.map((type) => {
                        const Icon = NODE_ICONS[type];
                        return (
                          <Tooltip key={type}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
                                aria-label={`Add ${NODE_LABELS[type]}`}
                                // A graph has one Start.
                                disabled={type === "start" && hasStart}
                                // Not disabled while locked, so the tooltip still shows and says how to unlock.
                                aria-disabled={locked || undefined}
                                onClick={() => addNode(type)}
                              >
                                <Icon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">{locked ? "Unlock editing to add nodes" : `Add ${NODE_LABELS[type]}`}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </Fragment>
                  ))}
                </Panel>
                <Panel position="top-center" role="toolbar" aria-label="Graph" className={cn(PANEL_CLASS, "flex items-center gap-2 py-1.5 pr-2 pl-3 whitespace-nowrap")}>
                  <span className="font-mono text-[13px] font-medium">{graphName}</span>
                  <Badge variant="outline" className="font-mono">
                    v{version}
                  </Badge>
                  {issues.length === 0 ? (
                    <Badge className="border-transparent bg-success-bg text-success">
                      <CheckIcon data-icon="inline-start" />
                      valid
                    </Badge>
                  ) : (
                    <Badge className="border-transparent bg-danger-bg text-danger">
                      <AlertTriangleIcon data-icon="inline-start" />
                      {issues.length} {issues.length === 1 ? "issue" : "issues"}
                    </Badge>
                  )}
                  <Separator orientation="vertical" className="mx-0.5 h-[18px] self-center" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="Tidy layout" onClick={tidy}>
                        <LayoutGridIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Tidy layout</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="Fit view" onClick={() => void fitView({ duration: 300 })}>
                        <MaximizeIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Fit view</TooltipContent>
                  </Tooltip>
                  <Separator orientation="vertical" className="mx-0.5 h-[18px] self-center" />
                  <Button size="sm" onClick={save} disabled={pending || saved || issues.length > 0}>
                    {!saved && <span aria-hidden className="size-[7px] rounded-full bg-primary-foreground/70" />}
                    {saved ? "Saved" : `Save as v${nextVersion}`}
                  </Button>
                  {runSlot}
                </Panel>
              </ReactFlow>
            </div>
            <aside aria-label="Inspector" className="flex min-h-0 flex-col border-l bg-card">
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col">
                  <Inspector graph={graph} selection={selection} locked={locked} library={library} dispatch={edit} onSelect={(nodeId) => setSelection({ nodeId })} />
                  {(issues.length > 0 || saveError) && (
                    <InspectorSection title="Issues">
                      <ul className="flex flex-col gap-1 text-xs text-danger">
                        {issues.map((issue) => (
                          <li key={`${issue.code}-${issue.nodeKey ?? ""}-${issue.edgeKey ?? ""}-${issue.message}`}>{issue.message}</li>
                        ))}
                        {saveError && <li>{saveError}</li>}
                      </ul>
                    </InspectorSection>
                  )}
                </div>
              </ScrollArea>
            </aside>
          </div>
        </div>
      </InvalidEdgesContext.Provider>
    </EdgeRoutesContext.Provider>
  );
}

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
