"use client";

import { flowOf } from "@/lib/flow";
import { Background, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes, type OnSelectionChangeParams } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useReducer, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckIcon, LayoutGridIcon, SaveIcon } from "lucide-react";
import { type FlowEdge, type FlowNode, type NodeType } from "@handoff/core";
import { loadGraphVersionAction, saveGraphAction } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EdgeRoute, LayoutResult } from "@/lib/elk-layout";
import { EdgeRoutesContext, useElkLayout, useMeasuredSignature } from "./elk-routes";
import { HandoffEdgeComponent } from "./handoff-edge";
import { HandoffNodeComponent } from "./handoff-node";
import { Inspector, type LibraryNames } from "./inspector";
import { NODE_ICONS } from "./node-icons";
import { changesEdit, documentOf, editorReducer, issuesOf, NODE_LABELS } from "./state";

const nodeTypes: NodeTypes = { handoff: HandoffNodeComponent };
const edgeTypes: EdgeTypes = { handoff: HandoffEdgeComponent };
const PALETTE = Object.keys(NODE_LABELS) as NodeType[];

export type VersionItem = { version: number; createdAt: string; createdBy: string | null };
type Props = {
  projectId: string;
  graphName: string;
  version: number;
  document: unknown;
  library: LibraryNames;
  versions: VersionItem[];
  runSlot?: React.ReactNode;
};

function Editor({ projectId, graphName, version: initialVersion, document, library, versions: initialVersions, runSlot }: Props) {
  const [graph, dispatch] = useReducer(editorReducer, document, flowOf);
  const [selection, setSelection] = useState<{ nodeId?: string; edgeId?: string }>({});
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [versions, setVersions] = useState(initialVersions);
  const [restoring, setRestoring] = useState<number | undefined>();

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
  const invalidNodes = useMemo(() => new Set(issues.map((i) => i.nodeKey).filter(Boolean)), [issues]);
  const nodes = useMemo(() => graph.nodes.map((n) => (invalidNodes.has(n.id) ? { ...n, data: { ...n.data, invalid: true } } : n)), [graph.nodes, invalidNodes]);

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
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    edit({ type: "addNode", nodeType, position: { x: Math.round(center.x), y: Math.round(center.y) } });
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveGraphAction(projectId, graphName, documentOf(graph));
      if (result.ok) {
        setVersion(result.version);
        setVersions((current) => [{ version: result.version, createdAt: new Date().toISOString(), createdBy: "dashboard" }, ...current]);
        setRestoring(undefined);
        setSaved(true);
        setSaveError(undefined);
      } else setSaveError(result.errors.map((e) => e.message).join("; "));
    });

  return (
    <EdgeRoutesContext.Provider value={routes}>
      <div className="grid h-[calc(100svh-3.5rem)] grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative min-w-0">
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={(changes) => edit({ type: "nodesChange", changes })}
            onEdgesChange={(changes) => edit({ type: "edgesChange", changes })}
            onConnect={(c) => edit({ type: "connect", source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle })}
            // One edge per pair of nodes, and never a node into itself: the graph is simple.
            isValidConnection={(c) => c.source !== c.target && !graph.edges.some((e) => e.source === c.source && e.target === c.target)}
            onSelectionChange={onSelectionChange}
            fitView
            minZoom={0.15}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
            <Panel position="top-left" className="flex flex-col gap-1 rounded-lg border bg-background p-1 shadow-sm">
              {PALETTE.map((type) => {
                const Icon = NODE_ICONS[type];
                return (
                  <Tooltip key={type}>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Add ${NODE_LABELS[type]}`} onClick={() => addNode(type)}>
                        <Icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Add {NODE_LABELS[type]}</TooltipContent>
                  </Tooltip>
                );
              })}
            </Panel>
            <Panel position="top-center" className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 shadow-sm">
              <span className="font-mono text-sm whitespace-nowrap">{graphName}</span>
              <Badge variant="outline">v{version}</Badge>
              {issues.length === 0 ? (
                <Badge variant="secondary">
                  <CheckIcon data-icon="inline-start" />
                  valid
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertTriangleIcon data-icon="inline-start" />
                  {issues.length} {issues.length === 1 ? "issue" : "issues"}
                </Badge>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Tidy layout"
                    onClick={tidy}
                  >
                    <LayoutGridIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Tidy layout</TooltipContent>
              </Tooltip>
              <Button size="sm" onClick={save} disabled={pending || saved || issues.length > 0}>
                <SaveIcon data-icon="inline-start" />
                {saved ? "Saved" : "Save version"}
              </Button>
              {runSlot}
            </Panel>
          </ReactFlow>
        </div>
        <aside className="flex min-h-0 flex-col border-l">
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-6 p-4">
              <Inspector graph={graph} selection={selection} library={library} dispatch={edit} onSelect={(nodeId) => setSelection({ nodeId })} />
              {!selection.nodeId && !selection.edgeId && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">History</h3>
                  {restoring !== undefined && <p className="text-xs text-muted-foreground">Showing v{restoring}. Save to make it the latest version.</p>}
                  <ul className="flex flex-col gap-1 text-sm">
                    {versions.map((v) => (
                      <li key={v.version} className="flex items-center justify-between gap-2">
                        <span className="tabular-nums">
                          v{v.version} <span className="text-xs text-muted-foreground">{v.createdAt.slice(0, 16).replace("T", " ")}</span>
                        </span>
                        <Button variant="ghost" size="sm" disabled={pending || v.version === version} onClick={() => restore(v.version)}>
                          {v.version === version ? "current" : "Restore"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(issues.length > 0 || saveError) && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Issues</h3>
                  <ul className="flex flex-col gap-1 text-xs text-destructive">
                    {issues.map((issue) => (
                      <li key={`${issue.code}-${issue.nodeKey ?? ""}-${issue.edgeKey ?? ""}-${issue.message}`}>{issue.message}</li>
                    ))}
                    {saveError && <li>{saveError}</li>}
                  </ul>
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
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
