"use client";

import { Background, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes, type OnSelectionChangeParams } from "@xyflow/react";
import { useCallback, useMemo, useReducer, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckIcon, LayoutGridIcon, SaveIcon } from "lucide-react";
import { toReactFlow, type FlowEdge, type FlowNode, type NodeType } from "@handoff/core";
import { saveGraphAction } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HandoffEdgeComponent } from "./handoff-edge";
import { HandoffNodeComponent } from "./handoff-node";
import { Inspector, type LibraryNames } from "./inspector";
import { NODE_ICONS } from "./node-icons";
import { documentOf, editorReducer, issuesOf, NODE_LABELS } from "./state";

const nodeTypes: NodeTypes = { handoff: HandoffNodeComponent };
const edgeTypes: EdgeTypes = { handoff: HandoffEdgeComponent };
const PALETTE = Object.keys(NODE_LABELS) as NodeType[];

type Props = { projectId: string; graphName: string; version: number; document: unknown; library: LibraryNames; runSlot?: React.ReactNode };

function Editor({ projectId, graphName, version: initialVersion, document, library, runSlot }: Props) {
  const [graph, dispatch] = useReducer(editorReducer, document, (doc) => toReactFlow(doc));
  const [selection, setSelection] = useState<{ nodeId?: string; edgeId?: string }>({});
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const issues = useMemo(() => issuesOf(graph), [graph]);
  const invalidNodes = useMemo(() => new Set(issues.map((i) => i.nodeKey).filter(Boolean)), [issues]);
  const nodes = useMemo(() => graph.nodes.map((n) => (invalidNodes.has(n.id) ? { ...n, data: { ...n.data, invalid: true } } : n)), [graph.nodes, invalidNodes]);

  const edit = useCallback((action: Parameters<typeof dispatch>[0]) => {
    dispatch(action);
    setSaved(false);
  }, []);

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
        setSaved(true);
        setSaveError(undefined);
      } else setSaveError(result.errors.map((e) => e.message).join("; "));
    });

  return (
    <div className="grid h-[calc(100svh-3.5rem)] grid-cols-[minmax(0,1fr)_22rem]">
      <div className="relative min-w-0">
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) => edit({ type: "nodesChange", changes })}
          onEdgesChange={(changes) => edit({ type: "edgesChange", changes })}
          onConnect={(c) => edit({ type: "connect", source: c.source, target: c.target })}
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
                  onClick={() => {
                    edit({ type: "layout" });
                    setTimeout(() => void fitView({ duration: 300 }), 50);
                  }}
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
            <Inspector graph={graph} selection={selection} library={library} dispatch={edit} />
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
  );
}

export function GraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
