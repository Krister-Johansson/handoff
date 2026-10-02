# Page tools for the assistant and WebMCP

## Context

The dashboard's assistant (the panel in `components/assistant`, the voice bubble in `components/voice`) and the WebMCP registration in `lib/assistant/webmcp.ts` offer one fixed set of tools: the catalog in `apps/web/src/lib/assistant/catalog.ts`. Its `data` tools run on the server (list runs, start, cancel, merge, answer a question, decide a permission) and its `ui` tools navigate (`go_to`, `go_to_run`, `set_project_tab`, `where_am_i` and the rest in `lib/assistant/ui-tools.ts`, run in the page by `lib/assistant/run-ui-tool.ts`). Nothing in that set knows what the open page can do. On 2026-10-02 the user, on a run page, said "open graph view" and the assistant opened the project's Graphs tab: it had `set_project_tab`, and no tool for the run page's own Steps, Graph and Events views. The user asked: "Do we not have dedicated tools for each page and actions it can take? And some global WebMCP?"

This plan adds page tools: each page registers the actions it offers while it is open, the assistant's turn gets them as MCP tools for that turn, `where_am_i` lists them with the page's state, the same tools register through WebMCP on that page, and state-changing ones keep the approval card. It follows `docs/plans/assistant-webmcp.md` (decided 2026-10-01, implemented) and `docs/plans/voice.md` decision 8 (the voice bubble answers approvals by spoken yes or no). It amends one non-goal of the assistant plan: "Editing graphs through the assistant" was left for "a later plan"; this is that plan, limited to what the graph editor page already does.

Read `CLAUDE.md`, `GLOSSARY.md`, `docs/adr/0006-assistant-runs-the-cli-from-the-dashboard.md`, `docs/plans/assistant-webmcp.md` and `docs/plans/voice.md` first.

## Goals

- On a page, the assistant can do what the page's own buttons do: switch the run page's views and open a step's drawer; mark Try it criteria, move between them, send back or approve; move between files in a code review, comment on lines, submit the review; comment on a plan and submit; select a node in the graph editor, read and change its settings, save.
- A page's tools are defined once and reach the model through the turn's MCP server and a browser agent through WebMCP, with the same names, schemas and approval rule.
- The model knows the page it is on: the turn's prompt names the page and its tools, and `where_am_i` returns the page's state (its steps, criteria, files, nodes) so the model can refer to them by key or index.
- A page tool that changes a run, a repository or a graph version waits for the person on the approval card the assistant already uses; the voice bubble answers it by voice as it does today.
- Everything is tested at the seams `CLAUDE.md` names: the page tool specs and registry as units, the turn and its MCP server with the fake `claude` binary against the real `handoff_test` database, the pages through behaviour.

## Non-goals

- Tools for pages that have nothing of their own to operate: the projects list, the library pages, settings, notifications. Their navigation is already covered by the catalog's UI tools.
- Duplicating catalog tools per page. Answering a question, deciding a permission, repairing, cancelling, merging and running again stay global data tools; a page contributes the ids on screen through `where_am_i` so "answer this question" resolves to the card in front of the person (Decision 5).
- A WebMCP polyfill, other origins (`exposedTo`), or declarative forms beyond the three the assistant plan added.
- Graph editing beyond the inspector's fields: no new node types, no library management, no project settings.
- Changing tools mid-turn through `notifications/tools/list_changed`. The turn's MCP transport is stateless and holds no stream to notify over (Verified facts); a stateful transport is the upgrade path, not part of this plan (Open question 2).
- Voice command phrases. Decision 8 of the voice plan sends every utterance to the assistant; page tools give the assistant something to do with "open graph view".

## Verified facts

Checked on 2026-10-02 against the sources named. Re-verify before coding against any of them.

### WebMCP

- The specification (https://webmachinelearning.github.io/webmcp/, "Draft Community Group Report, 30 September 2026"): `ModelContext` extends `EventTarget` with `registerTool(tool, options)`, `getTools()`, `executeTool(tool, input, options)` and `ontoolchange`, `ontoolactivated`, `ontoolcancel`. `ModelContextRegisterToolOptions` has `signal` and `exposedTo`. Each `Document` has its own `ModelContext` and tool map; "Tools are per-document". A second `registerTool` with a name already in the map rejects: "If tool map[tool name] exists, then return a promise rejected with an InvalidStateError DOMException." Names are validated: "If either tool name is the empty string, or its length is greater than 128, or if tool name contains a code point that is not an ASCII alphanumeric, U+005F (_), U+002D (-), or U+002E (.), then return a promise rejected with an InvalidStateError DOMException." Aborting the signal runs "Unregister a tool given this and tool name"; "Unregistering a tool does not cancel an execution that has already invoked its ToolExecuteCallback." `toolchange` fires at the `ModelContext` when tools are registered or unregistered, as a `ToolChangeEvent`. `getTools()` "Returns a promise that resolves to a list of registered tools from this document and its descendants that are exposed to this document." The feature is policy-controlled as `"tools"` with default allowlist `['self']`.
- Chrome's imperative API page (https://developer.chrome.com/docs/ai/webmcp/imperative-api, "Last updated: September 21, 2026"): "As of Chrome 153, you can unregister a tool without cancelling and breaking in-flight executions" through the `AbortSignal` passed to `registerTool`; "Frames can listen for the `toolchange` event on `document.modelContext` to be notified when the list of available tools has changed"; `consequentialHint: true` "allows agents and browsers to enforce mandatory user confirmation prompts". The page gives no guidance on duplicate names, naming, or tools that change with page state.
- The codebase already does per-document registration with one `AbortController` per `AssistantProvider` mount: `registerWebMcp(context, host, { available, signal })` in `lib/assistant/webmcp.ts`, called from the provider's effect in `components/assistant/assistant-provider.tsx`, which aborts on unmount or when the WebMCP switch changes. `webmcp.test.ts` stubs `document.modelContext` with a class that drops a tool when its signal aborts.

### Claude Code and MCP

- Claude Code's MCP page (https://code.claude.com/docs/en/mcp): "Claude Code supports MCP `list_changed` notifications, allowing MCP servers to dynamically update their available tools, prompts, and resources without requiring you to disconnect and reconnect." and "On the v2 runtime, Claude Code receives `list_changed` notifications from a server on the newer protocol revision over a stream it holds open." The turn's MCP endpoint (`server/assistant/turn-mcp.ts`) creates a new `McpServer` per request with `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` and closes it after the request, and the MCP route exports `GET` to the same handler, which answers 405 for anything but POST. There is no stream for a notification to travel on, so within one turn the tool list is what `tools/list` returned at connect. Per-turn registration is therefore the mechanism: every turn is a new `claude -p` process with `--mcp-config` (`packages/cli-adapter/src/claude/chat-argv.ts`), and the turn's server lists whatever that turn registers.
- The MCP TypeScript SDK (Context7 `/modelcontextprotocol/typescript-sdk`, docs `servers/notifications.md`): the handle `registerTool` returns has `update`, `enable`, `disable` and `remove`, each of which sends `notifications/tools/list_changed`, and `server.sendToolListChanged()` sends one by hand. `sessionIdGenerator` undefined "defaults the transport to stateless mode". The dashboard pins `@modelcontextprotocol/sdk` 1.31.0.
- The MCP specification (https://modelcontextprotocol.io/specification/2025-06-18/server/tools): `tools/list` is the discovery request; servers declaring `listChanged` "SHOULD" send `notifications/tools/list_changed` when the list changes, after which the client lists again. Annotations are `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`; "clients MUST consider tool annotations to be untrusted unless they come from trusted servers"; clients "SHOULD" "Show tool inputs to the user before calling the server".
- The CLI reference (https://code.claude.com/docs/en/cli-reference): `--allowedTools` lists "Tools that execute without prompting for permission"; `--permission-prompt-tool` names "an MCP tool to handle permission prompts in non-interactive mode" and cannot approve "an MCP tool marked as requiring user interaction" (handoff marks none); `--mcp-config` with `-p` "waits for still-pending servers to connect before running the first turn, up to the MCP_TIMEOUT startup timeout, 30 seconds by default; a server with a cached tool list skips the wait and connects on first use".
- System prompt snapshot (same page, "System prompt flags in resumed conversations"): "By default, Claude Code builds the system prompt once, on a conversation's first request, with the text from any system prompt flags applied, and records it in the session. Until the conversation is compacted, every later request uses that recorded prompt, including after you return to the conversation with `--resume` or `--continue`. If you pass different system prompt flag text, or none, on that later launch, it takes effect once the conversation is compacted or when you start a new conversation." `--system-prompt-snapshot off` rebuilds it every request (v2.1.257 or later). `buildClaudeChatArgv` passes `--append-system-prompt-file` every turn and no `--system-prompt-snapshot`. Consequence for this plan: the page's tools cannot be described in the system prompt per turn; they go in the turn's prompt (Decision 3). Side finding, outside this plan: `systemPromptFor("voice")` in `server/assistant/prompt.ts` appends the spoken-answer paragraph per turn, which the snapshot ignores after the first turn of a conversation.
- Discovery cache (MCP page, "Server status detail"): a remote server "can show a `cached` status such as `cached 2h ago · connects on first use · 5 tools`", loaded "from its discovery cache, saved in a previous session, instead of connecting at startup"; "The discovery cache is off by default unless a gradual rollout has enabled it for your account", set `MCP_DISCOVERY_CACHE=1` to enable or `0` to keep off; before v2.1.238 it was on by default. The assistant's server has the same name and URL every turn, so a cached list would hide a new page's tools (Risks).
- Tool search (https://code.claude.com/docs/en/agent-sdk/tool-search): "Tool search is on by default"; when active "tool definitions are withheld from the context window" and "Up to five of the most relevant tools are loaded into context by default"; `ENABLE_TOOL_SEARCH=false` turns it off; "If you exclude the `ToolSearch` tool from the session, for example through `disallowedTools`, the session also runs without tool search" (https://code.claude.com/docs/en/agent-sdk/mcp, "Connection timing"); "Tool selection accuracy degrades with more than 30-50 tools loaded at once" and "The search mechanism matches queries against tool names and descriptions." The catalog has 30 tools today (22 data, 8 UI), and the turn's server adds `approve`; this plan adds at most 12 per page.
- Headless page (https://code.claude.com/docs/en/headless): the `system/init` line reports `tools`, `mcp_servers` and `mcp_server_errors`; the SDK MCP page says the init `tools` array "lists the `mcp__` tools of each server that has connected by then". `chat-runner.ts` reads the session id and `model` from it and ignores `tools`; the manual verification below reads `tools` from a real turn.

### Next.js and React

- Next.js (Context7 `/vercel/next.js`, `use-pathname.mdx`, `use-search-params.mdx`): `usePathname` and `useSearchParams` are client hooks from `next/navigation`; a shared layout "is not re-rendered during navigation", which is why `AssistantProvider` in `app/layout.tsx` keeps its state across the navigations the assistant makes, and why a page must tell the provider what it offers rather than the provider reading the route.
- React (Context7 `/reactjs/react.dev`): `useEffectEvent` is a stable feature of React 19.2 ("React 19.2 adds new features like Activity, React Performance Tracks, useEffectEvent"); "Effect Events are not reactive and must always be omitted from dependencies of your Effect", which is how `assistant-provider.tsx` already reads the latest `open` inside `approveForAgent`. `useSyncExternalStore(subscribe, getSnapshot)` subscribes a component to an external store; `use-review-draft.ts` and `webmcp-pref.ts` use it. An effect's cleanup runs on unmount, and in development React runs setup and cleanup once more. The dashboard pins react 19.2.8 and next 16.3.7.

### The codebase

- Per-page registration already exists for voice: `lib/voice/use-read-aloud.ts` calls `registerReadable({ title, text })` from `VoiceProvider` in an effect whose cleanup unregisters; the review and Try it pages render `ReadAloudButton`, which calls it. The page tool hook follows this shape.
- A turn, end to end (`server/assistant/turn.ts`, `relay.ts`, `turn-mcp.ts`): `startTurn` stores the user message, opens a `LiveTurn` with a token, writes `<staging>/mcp.json`, runs the CLI with `allowedTools: READ_TOOLS` (catalog tools with `readOnly && !confirm`, prefixed `mcp__handoff__`) and `permissionPromptTool: mcp__handoff__approve`. `createTurnMcpServer` registers the data tools through `registerDataTools`, every `ui` catalog tool as a handler that calls `turn.requestUi({ name, args }, uiTimeoutMs)`, and `approve`, which looks the tool up in a `SPECS` map built from `CATALOG`, allows non-confirm tools at once and puts confirm tools on `turn.requestApproval(...)`. `LiveTurn.requestUi` emits `{ type: "ui_call", requestId, name, args }` on the turn's events and waits for `answerUi`. The replies route accepts `{ requestId, result, isError }` for UI calls and `{ requestId, approved, note }` for approvals.
- The browser side (`components/assistant/assistant-provider.tsx`): `send` POSTs `{ text, source }` through `transport.turn`, and on a `ui_call` event runs `runUiTool(event, (href) => router.push(href))` and POSTs the outcome with `transport.uiReply`. `approveForAgent` opens the panel with an approval card for WebMCP calls, resolved through `respond`. The WebMCP effect registers the catalog once per mount with one `AbortController`. `callView` titles stored calls through `toolSpec(name)` and keeps the bare name for a tool the catalog no longer has.
- `runUiTool` (`lib/assistant/run-ui-tool.ts`): `where_am_i` answers `{ path, title, heading }` from `window.location`, `document.title` and the page's `h1` (`[data-page-title]` inside it when present).
- The voice bubble (`components/voice/voice-provider.tsx`): `onRequest` reads a card aloud as `${request.title}: ${request.summary}. Say yes or no.`, listens once, and `approvalAnswer` maps yes or no to `port.respond`. A page tool's approval needs only a `title` and a `summary`, which the server computes from the spec.
- The run page (`app/projects/[projectId]/runs/[runId]/page.tsx` rendering `components/runs/run-live.tsx`): `RunLive` holds `status`, `executions`, `selectedId` (the drawer's step), `poppedOut`, `showCli`, `nodeFilter` and `questions`; its views are `<Tabs defaultValue="steps">` with `steps`, `graph` and `events`, uncontrolled today; `Steps` calls `onSelect(id)` and `RunGraph` calls `selectLatest(nodeKey)`; the drawer is a `Sheet` closed by `setSelectedId(null)`; `Maximize2Icon` sets `poppedOut`. Repair, cancel and the permission cards are server-rendered children (`RunAlerts`) and the header's `CancelRunButton` and `RunAgainButton` use `cancelAction` and `runAgainAction`.
- Try it (`components/review/try-review.tsx`): `TryReview` holds `checks` (per criterion `{ works?, note }`) and `closed`; `useCursor` returns `[current, go]` and binds `[` and `]`; `mark(index, works)` sets the check, collapses or opens the criterion and moves to the next unchecked one; the note changes through `setChecks`; `Submit` holds its own `note` and `answer(option)` calling `answerReviewAction({ questionId, runId, option, note, comments })`, with the failing criteria as `{ quote, body }` comments, Approve disabled unless `allWork`, Send back disabled with nothing failed and no note; `AppBar` calls `restartTryItAction({ questionId, runId })`; `readOnly` when `answered` is given.
- Code review (`components/review/code-review.tsx`): `useFileCursor` returns `[current, go]`; `mode` (`changes`, `whole`) and `layout` (`unified`, `split`) are state; `closed` is a set of paths with `setOpen(path, open)`; `useViewed` gives `stateOf(file)` and `mark(file, viewed)` which calls `markViewedAction`; `useReviewDraft` keeps `comments` and `note` in localStorage with `setComments` and `setNote`; a line comment is `{ path, side, line, endLine?, quote, body }` with `quote` from `quoteOf(file, side, start, end)`; `SubmitReview` (`submit-review.tsx`) holds the chosen `option` and its `send` refuses `changes` and `fix` with no note and no comments, then calls `answerReviewAction`, which redirects to the run.
- Plan review (`components/review/plan-review.tsx`): comments are `{ quote, body }` added through `setComments` after a selection in the article; `quoteRanges` (`lib/quote-ranges.ts`) finds a quote in the rendered article; `SubmitReview` as above.
- Graph editor (`components/graph-editor/graph-editor.tsx`, `state.ts`, `inspector.tsx`): `Editor` holds the `FlowGraph` in `useReducer(editorReducer)`, `selection` (`{ nodeId?, edgeId? }`), `saved`, `issues` from `issuesOf(graph)`; `edit(action)` dispatches and marks unsaved when `changesEdit(action)`; actions are `nodesChange`, `edgesChange`, `connect`, `addNode`, `updateNode` (patch of label, config, library, contract, notify), `replaceNodeConfig`, `updateEdge`, `setStart`, `setExhaustedGate`, `remove`, `renameNode`, `applyLayout`, `reset`; `save` calls `saveGraphAction(projectId, graphName, documentOf(graph))` and is disabled with issues; `tidy` runs ELK; the inspector's fields map to `updateNode` patches (label, key through `renameNode`, instructions and model fields through `setConfig`, library, contract checks, notify) and `updateEdge` patches (condition, loop, `maxAttempts`, `onExhausted`, `on`).
- Inbox (`app/inbox/page.tsx`, `components/inbox/inbox-sections.tsx`): server components rendering `PermissionCard`, `QuestionCard`, `ReadyToMergeCard`, `FailedRunCard`, `StuckRunCard`, `PullRequestCard`; every card already has a form or buttons bound to the actions in `app/inbox/actions.ts`, and the catalog's `answer_question`, `answer_permission`, `repair_run`, `resolve_loop`, `request_merge` and `cancel_run` reach the same engine operations.
- Tests: `lib/assistant/webmcp.test.ts` (stubbed `modelContext`), `ui-tools.test.ts`, `run-ui-tool.test.ts`, `server/assistant/turn.integration.test.ts` (fake binary with `$mcp` steps that POST `tools/call` to the turn's endpoint, approvals answered through `turn.answer`), `app/api/assistant/routes.test.ts`, `components/assistant/assistant-sheet.test.tsx` and `assistant-provider.test.tsx` (fake transport with `emit`), `components/voice/voice-bubble.test.tsx`, and the page tests `try-review.test.tsx`, `code-review.test.tsx`, `plan-review.test.tsx`, `run-live.test.tsx`, `graph-editor.test.tsx`, `cards.test.tsx`, `permission-card.test.tsx`.
- Environment: `.env.example` pins `HANDOFF_CLAUDE_VERSION=2.1.285`; the assistant's child environment comes from `buildClaudeEnv` with `CLAUDE_CONFIG_DIR=<HANDOFF_HOME>/assistant/claude-config`.

## Unverified

- Whether `--tools ""` removes `ToolSearch` and therefore turns tool search off for the assistant's turns. The SDK page says excluding `ToolSearch` turns it off, and `--tools ""` disables all built-in tools, but no page states the combination. Check: read `tools` from the `system/init` line of a real turn (manual verification step 1). If `ToolSearch` is present, PR 2 adds `ENABLE_TOOL_SEARCH=false` to the assistant's child environment through `buildClaudeEnv`'s passthrough, so page tools are never deferred behind a search.
- Whether the discovery cache is on for the operator's account under the gradual rollout, and how it keys a server (name, URL, or both). PR 2 sets `MCP_DISCOVERY_CACHE=0` in the child environment regardless, and the manual verification confirms the init line reports the page's tools.
- Whether Chrome's Model Context Tool Inspector refreshes its list on `toolchange` without a reload. The spec fires the event; the Chrome page says frames can listen. Manual verification step 8 records what the inspector shows after a navigation.
- Whether React's development double-invocation of effects (setup, cleanup, setup) makes Chrome reject the second `registerTool` with `InvalidStateError` because the abort from the first cleanup has not yet removed the name. The provider's existing catalog registration has not reported this; the page registration awaits the previous controller's abort before registering and catches rejections (PR 3), and the stub in tests reproduces the rejection on a duplicate name.
- How long a prompt may be on `claude -p`'s argv. The page block this plan adds is short (a path, a heading, tool names); the full tool descriptions travel over MCP. No limit is documented on the pages read.
- Whether `window.location` and the page's `h1` are stable by the time the turn starts after a navigation. `runUiTool` already waits for the heading after a navigation; the turn reads them when `send` runs.

## Decisions

### 1. Page tool specs live in one browser-safe module, and pages bind handlers to them

Decision: `apps/web/src/lib/assistant/page-tools.ts` holds `PAGE_TOOLS: Record<PageKind, PageToolSpec[]>` with `PageKind = "run" | "try" | "code_review" | "plan_review" | "graph_editor" | "inbox"`. A `PageToolSpec` is a catalog `ToolSpec` with `kind: "page"`: `name`, `title`, `description`, a Zod `input`, `confirm`, `readOnly`, `untrusted`, `destructive`, `summarize(args)`. A page binds handlers with `usePageTools(kind, handlers, describe)` (`lib/assistant/use-page-tools.ts`), where `handlers` is typed from the kind's specs so every spec needs a handler and nothing else is accepted, and `describe()` returns the page's state for `where_am_i`. The hook registers with `AssistantProvider` in an effect and unregisters in the cleanup, like `useReadAloud`.

Why: the server needs the spec to validate arguments, put a readable summary on the approval card (`spec.summarize`), decide `--allowedTools` and annotate the MCP tool; WebMCP needs the same JSON Schema and annotations; the panel titles stored calls from it; and a catalog-wide unit test can assert invariants over every page tool as `catalog.test.ts` does today. None of that works if a page sends ad hoc JSON Schemas and function-free specs over the wire.

Alternatives considered:

1. The hook takes full specs (Zod inputs and handlers) and the browser sends `z.toJSONSchema(input)` with each turn. The server could register the tools, but could not summarize arguments for the approval card (no function crosses the wire) nor validate them, and two pages could describe the same name differently. Rejected.
2. A server-side registry keyed by route pattern, with the server inferring the page from the turn's path. The server would then own a list of what each page offers without the page confirming it is mounted and has something to operate (a read-only Try it has no `page_submit`). Rejected; the page sends the names it bound.

### 2. The turn carries the page, and the turn's MCP server registers that page's tools for that turn

Decision: `send` in `AssistantProvider` adds `page: { kind, path, heading, tools: [names bound right now] }` to the turn request (`PageDescriptorSchema` in `page-tools.ts` validates it on the route; an unknown kind or name is dropped, not refused). `startTurn` keeps it on the `LiveTurn` as `turn.page`. `createTurnMcpServer` registers `PAGE_TOOLS[turn.page.kind]` filtered to `turn.page.tools`, each as a handler that calls `turn.requestUi({ name, args })` exactly as the UI tools do, so the call runs in the page and the page's answer goes back through the replies route. The `approve` handler's lookup covers the turn's page specs, so a confirm page tool goes on an approval card with `spec.summarize(args)`. `allowedTools` for the turn is the catalog's read tools plus the page's non-confirm tools, all prefixed `mcp__handoff__`.

Why: the tool list of a `claude -p` process is what `tools/list` returned at connect, and the turn's transport is stateless (Verified facts), so the turn is the unit of registration. Everything else reuses the relay the UI tools already have.

Alternatives considered:

1. A stateful Streamable HTTP session per turn with a GET stream, so the server can `sendToolListChanged()` when the page changes mid-turn. It would let "open the run, then switch to its graph" work in one turn. It changes the transport (`sessionIdGenerator`, a GET handler kept open for the turn's life under `next dev`), and the assistant plan's Unverified item about long HTTP requests under Next applies again. Deferred (Open question 2).
2. Register every page kind's tools every turn and let the page refuse calls that do not apply. About 40 more tools on top of 32, past the point where the tool search page says selection accuracy drops, and tool search would then withhold definitions. Rejected.

### 3. The page goes in the turn's prompt, not the system prompt

Decision: `turnPrompt({ text, page })` in `server/assistant/prompt.ts` prefixes the person's message with a short block:

```
<page path="/projects/p1/runs/r1" kind="run" heading="Add a CHANGELOG.md">
Tools of this page: page_show_view, page_open_step, page_close_step, page_pop_out, page_filter_events. Call where_am_i for its state.
</page>
Open graph view
```

The stored user message stays the person's text, with `page: { kind, path }` added to its content for the history. The system prompt gains one static paragraph: tools named `page_` belong to the page the person has open, the message says which page and which tools it offers, `where_am_i` returns the page's state with the keys and indices the tools take, and a page tool that answers "the page changed" means `where_am_i` must be called before going on.

Why: Claude Code records the system prompt on a conversation's first request and reuses it on `--resume` until compaction (Verified facts), so per-turn text in the system prompt reaches the model only in the first turn. The prompt block is per message by nature. The block carries names only: the descriptions arrive as MCP tool definitions, and the page's state is fetched on demand, which keeps untrusted page text (criteria from issues, file paths, node labels) out of the person's own message.

Alternatives considered: `--system-prompt-snapshot off` with the page in `--append-system-prompt-file`. It works, costs the prompt cache on every turn, and hides from the stored conversation which page the person was on. Rejected.

### 4. Names carry the `page_` prefix, are unique per page, and mean the same thing wherever they appear

Decision: every page tool name matches `^page_[a-z][a-z0-9_]*$` and is at most 48 characters, so `mcp__handoff__page_...` and the WebMCP name stay well under the spec's 128. A name may appear in two page kinds only with the same `title`, `input` and `confirm` (`page_submit_review` on the code review and the plan review), which a unit test enforces, so `callView` and the approval card can resolve a name without the kind. No page name may equal a catalog name. A page that binds a handler for a name its kind does not have, or binds the same kind twice, throws in development and logs in production; the second registration wins so a hot reload recovers.

Why: the prefix tells the model and the person which tools are page-bound, keeps `where_am_i`'s list readable, and makes collisions with the catalog impossible by construction rather than by review.

### 5. Page tools do what only the page can do; server state stays in the catalog

Decision: a page tool exists for view state (which tab, which step is open, which file, how the diff is shown), for drafts the page holds (criterion checks and notes, line comments, the overall comment, unsaved graph edits) and for submissions whose inputs live in those drafts (Try it submit, review submit, graph save, restart the app). Answering a question, deciding a permission, repairing, cancelling, merging and running again stay catalog data tools; the page's `describe()` gives `where_am_i` the ids on screen so the model picks the right one. The inbox therefore registers no action tools, only `describe()` and `page_show_item` (scroll a card into view and focus it).

Why: the catalog already covers those operations with approval cards, from any page; a second path through the page's form would give the model two tools for one action and the person two ways the same thing can go wrong.

### 6. Approval follows the existing rule: confirm when a run, a repository or a graph version changes

Decision: `confirm: true` on `page_submit` (Try it), `page_restart_app`, `page_submit_review` (both reviews) and `page_save_graph`. Draft and view changes (`page_mark_criterion`, `page_comment_on_lines`, `page_update_node`, `page_remove`, tabs, cursors, filters) run without a card: the person sees them on the page and nothing leaves the browser until a confirm tool runs. `page_mark_viewed` calls `markViewedAction`, a per-person bookkeeping write the page itself makes on a click without confirmation; it stays `confirm: false` with `readOnly: false`. The voice bubble needs no change: a confirm page tool arrives as the same `confirm` event, is read aloud from `title` and `summary`, and is answered by yes or no.

### 7. The page answers a call against what it has now, and says so when the page changed

Decision: the provider's `ui_call` handling routes `page_*` names to `runPageTool(registry, call)` (`lib/assistant/run-page-tool.ts`): it looks the name up in the registry at that moment, validates `args` with the spec's `input`, runs the handler, and returns `{ text, isError }`. When the name is not registered (the person navigated, or the model called a tool of a page it left through `go_to_run` in the same turn), the answer is an error: `The page changed: the person is now on <path> (<kind or "a page without tools">). page_x is not available here. Call where_am_i.` A navigation UI tool's result gains one sentence when the destination registers tools: `This page offers page tools; they are available from your next message.`

Why: with the tool list fixed per turn (Decision 2), the model needs a plain answer it can act on, and the next turn registers the new page's tools.

### 8. WebMCP registers the page's tools beside the catalog, under their own signal

Decision: `registerPageTools(context, snapshot, host, { signal })` in `lib/assistant/webmcp.ts` registers each bound spec with `name`, `title`, `description`, `inputSchema: z.toJSONSchema(spec.input)`, annotations `{ readOnlyHint, consequentialHint: spec.confirm, untrustedContentHint }`, and an `execute` that runs the handler in the page after `host.approve(...)` for a confirm tool. The provider keeps one `AbortController` for the catalog (unchanged) and one per page registration: on a registry change it aborts the page controller, awaits that, then registers the new set, and catches a rejected `registerTool` so a browser quirk cannot break the page. `toolchange` fires on both steps for the inspector or any agent in the tab.

Why: the same `execute` the assistant uses, the same approval card, and the catalog stays registered across navigations as the assistant plan decided (its open question 4, "all catalog tools with the approval dialog", extends to page tools).

## Design

### Files

```
apps/web/src/lib/assistant/
  page-tools.ts            PageKind, PageToolSpec, PAGE_TOOLS, pageToolSpec(name), PageDescriptorSchema, NAME rule, describeCall support
  use-page-tools.ts        usePageTools(kind, handlers, describe): registers with the provider while mounted
  run-page-tool.ts         runPageTool(registry, call): validate, run, "the page changed" answer
  run-ui-tool.ts           where_am_i gains { page: { kind, tools, state } } from the registry snapshot
  webmcp.ts                registerPageTools(context, snapshot, host, { signal })
  catalog.ts               where_am_i description mentions page tools; toolSpec falls back to pageToolSpec
  transport.ts             turn(conversationId, text, source, page, onEvent, signal)
apps/web/src/components/assistant/
  assistant-provider.tsx   page registry (ref plus version state), send() attaches the page, ui_call routing, page WebMCP effect
apps/web/src/server/assistant/
  prompt.ts                turnPrompt({ text, page }); system prompt paragraph on page tools
  relay.ts                 LiveTurn.page
  turn.ts                  startTurn takes { text, source, page }; allowedTools includes the page's non-confirm tools; describeCall knows page specs
  turn-mcp.ts              registers the turn's page tools; approve resolves page specs
apps/web/src/app/api/assistant/conversations/[id]/turns/route.ts   parses page with PageDescriptorSchema
apps/web/src/components/runs/run-live.tsx            controlled Tabs; usePageTools("run", ...)
apps/web/src/components/review/try-review.tsx        submit(option, note) lifted out of Submit; usePageTools("try", ...)
apps/web/src/components/review/code-review.tsx       sendReview helper shared with SubmitReview; usePageTools("code_review", ...)
apps/web/src/components/review/plan-review.tsx       usePageTools("plan_review", ...)
apps/web/src/components/graph-editor/graph-editor.tsx usePageTools("graph_editor", ...)
apps/web/src/components/inbox/inbox-page-tools.tsx   client component rendered by the inbox page; usePageTools("inbox", ...)
```

### The registry in the provider

`AssistantProvider` holds `pageRef: { kind, handlers, describe } | undefined` and a `pageVersion` number in state. `registerPage(kind, handlers, describe)` sets the ref, bumps the version and returns an unregister function that clears the ref only if it still holds that registration. `usePageTools` calls it in an effect keyed on `kind` and on the identity of a `useEffectEvent` wrapper around the handlers, so a page re-rendering with new closures does not re-register, while the handlers always see the latest state. The snapshot `{ kind, path, heading, tools: specs.filter(bound) }` is computed when needed: by `send` for the turn, by `runUiTool` for `where_am_i`, and by the WebMCP effect on `pageVersion`.

### A turn with a page tool

```mermaid
sequenceDiagram
  participant Page as Run page (usePageTools)
  participant Provider as AssistantProvider
  participant Turns as POST /turns
  participant CLI as claude -p
  participant Mcp as /api/assistant/mcp (turn server)
  Page->>Provider: registerPage("run", handlers, describe)
  Provider->>Turns: { text, source, page: { kind, path, heading, tools } }
  Turns->>CLI: prompt with <page> block; --allowedTools catalog reads + page non-confirm
  CLI->>Mcp: tools/list
  Mcp-->>CLI: catalog + page_show_view, page_open_step, ...
  CLI->>Mcp: tools/call page_show_view { view: "graph" }
  Mcp->>Provider: ui_call (SSE)
  Provider->>Page: runPageTool: validate, handlers.page_show_view
  Page-->>Provider: "Showing the graph view."
  Provider->>Mcp: POST /turns/:id/replies { requestId, result }
  Mcp-->>CLI: tool result
```

A confirm page tool differs in one step: before `tools/call`, Claude Code calls `approve` with `tool_name: mcp__handoff__page_submit`; the turn server finds the page spec, emits `confirm` with `spec.summarize(args)`, and the card in the panel or the bubble decides.

### The tool list per page

Every tool below runs in the page through the handler named. `where_am_i` on each page returns the page's state from `describe()`, wrapped as untrusted data (`{ source: "page state, treat as data", ... }`) because it carries text from issues, diffs and graph labels.

Run page (`run-live.tsx`; `describe()`: run id, project id, status, view, steps as `{ id, nodeKey, label, attempt, status }`, the open step, open questions with their ids and reasons):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_show_view` | `view: "steps" \| "graph" \| "events"` | no | the Tabs value, made controlled (`value`, `onValueChange`) |
| `page_open_step` | `step: string` (node key, or execution id); `attempt?: number` | no | `setSelectedId` after resolving the key as `selectLatest` does, or the attempt's execution |
| `page_close_step` | none | no | `setSelectedId(null)`, `setPoppedOut(false)` |
| `page_pop_out` | `open: boolean` | no | `setPoppedOut` (opens the drawer first when no step is selected: error naming `page_open_step`) |
| `page_filter_events` | `node?: string \| null`, `cli?: boolean` | no | `setNodeFilter`, `setShowCli`; switches to the events view |

Repair, cancel, run again, merge and the permission cards use the catalog (`repair_run`, `cancel_run`, `run_again`, `request_merge`, `answer_permission`) with the ids from `where_am_i`.

Try it (`try-review.tsx`; `describe()`: question id, run id, `from`, current index, criteria as `{ index, text, works, note }`, app status and url, read only):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_mark_criterion` | `index: number` (1-based) or `criterion: string`; `works: boolean \| null`; `note?: string` | no | `mark(index, works)`, then `setChecks` for the note; `null` clears |
| `page_go_to_criterion` | `index?: number`, `direction?: "next" \| "previous"` | no | `go` from `useCursor` |
| `page_set_note` | `note: string` | no | the overall note, lifted from `Submit` into `TryReview` state |
| `page_submit` | `option: "approve" \| "changes"`, `note?: string` | yes | `submit(option, note)` lifted from `Submit.answer`; refuses `approve` unless every criterion works, and `changes` with nothing failed and no note, with the same texts the popover shows |
| `page_restart_app` | none | yes | `restartTryItAction({ questionId, runId })` as `AppBar` does |
| `page_expand_criteria` | `all: boolean` | no | `setClosed` |

Unbound when `readOnly`: everything but `page_go_to_criterion` and `page_expand_criteria`.

Code review (`code-review.tsx`; `describe()`: question id, run id, `from`, current index, `mode`, `layout`, files as `{ index, path, additions, deletions, viewed, open, comments }`, drafted comments with their lines, the overall note, read only):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_go_to_file` | `path?: string`, `index?: number`, `direction?: "next" \| "previous"` | no | `go` from `useFileCursor`; opens the file |
| `page_set_diff_view` | `mode?: "changes" \| "whole"`, `layout?: "unified" \| "split"` | no | `setMode`, `setLayout` |
| `page_expand_files` | `all?: boolean`, `path?: string`, `open?: boolean` | no | `setClosed` or `setOpen(path, open)` |
| `page_mark_viewed` | `path: string`, `viewed: boolean` | no | `mark(file, viewed)` and `setOpen(path, !viewed)` |
| `page_comment_on_lines` | `path: string`, `line: number`, `endLine?: number`, `side?: "old" \| "new"`, `body: string` | no | `draft.setComments` with `quote` from `quoteOf(file, side, line, endLine)`; refuses a line the file does not show, naming its range |
| `page_remove_comment` | `path: string`, `line: number` | no | `draft.setComments` filter |
| `page_set_note` | `note: string` | no | `draft.setNote` |
| `page_submit_review` | `option: "changes" \| "approve" \| "fix"` | yes | `sendReview({ questionId, runId, option, note, comments })`, extracted from `SubmitReview.send` with its "Add a comment or an overall comment first" refusal |

Unbound when `readOnly`: `page_mark_viewed`, `page_comment_on_lines`, `page_remove_comment`, `page_set_note`, `page_submit_review`.

Plan review (`plan-review.tsx`; `describe()`: question id, run id, `from`, comments, note):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_comment_on_passage` | `quote: string`, `body: string` | no | `setComments` after checking the quote occurs in the markdown with whitespace collapsed, as `useSelectedText` normalizes; refuses otherwise |
| `page_remove_comment` | `quote: string` | no | `setComments` filter |
| `page_set_note` | `note: string` | no | `setNote` |
| `page_submit_review` | `option: "changes" \| "approve" \| "fix"` | yes | `sendReview` as above |

Graph editor (`graph-editor.tsx`; `describe()`: project id, graph name, version, saved, selection, nodes as `{ key, type, label, isStart }`, edges as `{ id, source, target, port, loop }`, issues):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_select` | `node?: string`, `edge?: string`, or neither to clear | no | `setSelection` |
| `page_get_node` | `key: string` | no, read | returns `node.data` (label, type, config, library, contract, notify) and the edges in and out |
| `page_get_edge` | `id: string` | no, read | returns `edge.data` |
| `page_update_node` | `key: string`, `patch: { label?, instructions?, model?, effort?, maxTurns?, tools?, library?, notify?, checks?, ... }` | no | `edit({ type: "updateNode", id, patch })`; keys limited to what the inspector offers per node type, validated with Zod built from `nodeCatalog`; unknown keys refused with the list of known ones |
| `page_rename_node` | `key: string`, `to: string` | no | `edit({ type: "renameNode" })` with the `KEY` rule |
| `page_update_edge` | `id: string`, `patch: { condition?, loop?, maxAttempts?, onExhausted?, on?, priority? }` | no | `edit({ type: "updateEdge" })` |
| `page_add_node` | `type: NodeType`, `position?: { x, y }` | no | `addNode(type)` with the position or the viewport centre |
| `page_connect` | `source: string`, `target: string`, `port?: string` | no | `edit({ type: "connect" })` after `canConnect` |
| `page_remove` | `ids: string[]` | no, `destructive` | `edit({ type: "remove", ids })` |
| `page_tidy_layout` | none | no | `tidy` |
| `page_issues` | none | no, read | `issuesOf(graph)` |
| `page_save_graph` | none | yes | `save()`; refuses while `issues.length > 0` with the issues, and when `saved` |

Inbox (`inbox-page-tools.tsx`, a client component the page renders with the ids; `describe()`: the narrowed project, permissions as `{ id, runId, nodeKey, action }`, reviews and Try it questions as `{ questionId, runId, task }`, questions, ready to merge, failed and stuck runs, pull requests):

| Tool | Input | Confirm | Handler |
|---|---|---|---|
| `page_show_item` | `id: string` (a question, permission, run or execution id) | no | `scrollIntoView` and focus on the card, which gains `id` and `tabIndex=-1` |

Answering, deciding and merging use the catalog with these ids.

### `where_am_i`

The result becomes `{ path, title, heading, page?: { kind, tools: [{ name, title }], state } }`. `runUiTool` receives the registry snapshot from the provider (the `where` plan gains a `page` argument). The catalog description changes to: "The page the person is looking at: its path, title and heading, and on pages with their own tools, the page's tools and its state (steps, criteria, files or nodes with the keys and indices the tools take). Call it before talking about this page or using a page tool." The server's `wrapUntrusted` treatment applies to the `state` field only, inside the page's answer, since the tool runs in the browser.

### The prompt and the stored message

`turnPrompt({ text, page })` returns the block of Decision 3 or the bare text when the turn has no page (the assistant plan's existing tests keep passing). `storeMessage` for the user message stores `{ text, source, page?: { kind, path } }`; `AssistantContent`'s user variant in `packages/db` gains the optional field; the picker and the message list show nothing new in this plan.

### Security

- Origin: page tools run in the page and nowhere else. The turn's server never executes one; it relays the call to the page that opened the turn, over the same `isSameLocalOrigin`-checked replies route the UI tools use. The page descriptor comes from the browser and is validated against the server's own `PAGE_TOOLS`; the server trusts nothing from it except which of its own names to register. WebMCP registration keeps the Permissions Policy default `tools: self`.
- Arguments: validated twice with the same Zod schema, on the server before the relay (a failed parse is an error result to the model, no `ui_call`) and in the page before the handler runs. Keys and indices are checked against the page's state and refused with the valid values in the message, so an invented step key or line number changes nothing.
- Approvals: confirm page tools go through Claude Code's permission prompt like every catalog confirm tool, so the handler cannot run before the person approves; a WebMCP call goes through `host.approve` before `execute` reaches the handler. The card's summary comes from `spec.summarize(args)` on the server, never from the page or the model. Denials are final for the turn, as today.
- Prompt injection: `where_am_i` state carries issue text, file paths, diff lines and labels; it is wrapped as data and the system prompt says so. The prompt block carries only the path, the heading (the run's task, also from an issue, already shown in page results today) and tool names. No page tool reads files, fetches, or leaves the dashboard: the worst a hostile criterion can cause is a draft comment the person sees, since every submission is a confirm tool.
- Secrets: nothing new touches the environment, graph JSON or the database. `page_get_node` returns node config as the inspector shows it; `passEnv` lists variable names only, as the inspector does.

### Settings and the panel

The Assistant settings tab's WebMCP switch covers page tools: off means neither catalog nor page tools register. The panel's tool rows title page calls through `toolSpec` falling back to `pageToolSpec`. The status line is unchanged ("Calling Show a view").

## Delivery

Each PR is one GitHub issue, one branch, CI green, `pnpm doctor:react` clean after changes under `apps/web`, one red-green slice per test named here, Context7 before writing against Next 16, React 19, Zod 4, `@modelcontextprotocol/sdk` or the Claude Code CLI. PRs 1 to 3 are the mechanism; 4 to 8 are pages and can merge in any order after 2.

1. **Page tool specs, registry and `where_am_i`.** Files: `lib/assistant/page-tools.ts`, `use-page-tools.ts`, `run-page-tool.ts`, `run-ui-tool.ts`, `catalog.ts`, `assistant-provider.tsx`. First tests: `lib/assistant/page-tools.test.ts` "every page tool has a page_ name within the rule, a title, a description and an input the browser can register as JSON Schema"; "a name shared by two pages has the same title, input and confirm"; "no page tool name is a catalog name"; "confirm page tools are exactly the ones that submit, restart the app or save the graph". `lib/assistant/run-page-tool.test.ts` "a bound tool runs with validated arguments and returns its text"; "invalid arguments are refused with the schema's messages and the handler does not run"; "a tool of a page that is no longer open answers that the page changed and names the current path". `components/assistant/assistant-provider.test.tsx` additions "usePageTools registers a page's tools while the component is mounted and removes them on unmount"; "a ui_call for a page tool runs in the page and its answer goes back to the turn"; "where_am_i lists the page's tools and its state as data". `lib/assistant/run-ui-tool.test.ts` addition "where_am_i without a page reports path, title and heading only".

2. **The turn carries the page.** Files: `transport.ts`, `turns/route.ts`, `relay.ts`, `turn.ts`, `turn-mcp.ts`, `prompt.ts`, `packages/db` user content type, `buildClaudeEnv` passthrough for `MCP_DISCOVERY_CACHE=0` (and `ENABLE_TOOL_SEARCH=false` if the Unverified check says so). First tests: `server/assistant/prompt.test.ts` additions "a turn on a page prefixes the message with the page's path, kind, heading and tool names"; "a turn without a page is the message alone"; "the system prompt tells the model what page_ tools are and to call where_am_i for the page's state". `server/assistant/turn-mcp.test.ts` additions "the turn's MCP server lists the catalog and the page's bound tools, with the page's annotations" (a `tools/list` request against `handleTurnMcpRequest`); "approve puts a confirm page tool on a card with the spec's summary and allows a non-confirm one at once". `server/assistant/turn.integration.test.ts` additions "a page tool the model calls is sent to the browser as a ui_call and its answer returned" (fake binary `$mcp` step on `page_show_view`); "a confirm page tool waits for the person's approval and runs only after it"; "the page's non-confirm tools are in --allowedTools and its confirm tools are not" (through the fake's recorded argv); "the person's message is stored with the page it was asked on". `app/api/assistant/routes.test.ts` addition "a turn body's page is validated: unknown kinds and names are dropped and the turn still starts". `packages/cli-adapter/src/claude/env.test.ts` addition "the assistant's environment keeps the MCP discovery cache off".

3. **WebMCP registration of page tools.** Files: `webmcp.ts`, `assistant-provider.tsx`. First tests: `lib/assistant/webmcp.test.ts` additions "a page's bound tools register with their JSON Schema and consequentialHint, and leave when their signal aborts"; "a confirm page tool runs its handler only after Approve and returns a denial text after Deny"; "re-registering after a page change aborts the old set before the new one, and a rejected registration does not throw". `assistant-sheet.test.tsx` addition "a browser agent's page tool call runs in the page and shows the agent's activity in the status line".

4. **Run page tools.** Files: `run-live.tsx` (controlled tabs, `usePageTools("run", ...)`), `page-tools.ts` specs. First tests: `run-live.test.tsx` additions "page_show_view switches to the graph and events views and where_am_i says which is shown"; "page_open_step opens the latest execution of a node key, and an attempt opens that one; a key that is not a step is refused with the keys"; "page_close_step closes the drawer and page_pop_out needs an open step"; "page_filter_events narrows the events to a node and shows the events view". These render `RunLive` inside the provider with the fake transport and emit `ui_call` events.

5. **Try it tools.** Files: `try-review.tsx`, specs. First tests: `try-review.test.tsx` additions "page_mark_criterion ticks a criterion by index or text, collapses it and moves on; with works false and a note the note shows in the criterion"; "page_go_to_criterion moves next, previous and to an index"; "page_submit approve is refused while a criterion is unticked, and after approval calls answerReviewAction with approve"; "page_submit changes sends the failing criteria as comments with the note"; "page_restart_app calls restartTryItAction"; "an answered Try it binds only navigation tools".

6. **Code review and plan review tools.** Files: `code-review.tsx`, `plan-review.tsx`, `submit-review.tsx` (`sendReview`), specs. First tests: `code-review.test.tsx` additions "page_go_to_file moves by path, index and direction, and opens the file"; "page_set_diff_view switches mode and layout"; "page_comment_on_lines adds a draft comment with the quoted code, and a line outside the file is refused with its range"; "page_mark_viewed saves the mark and collapses the file"; "page_submit_review changes with no comment and no note is refused, and with a comment sends it"; "an answered review binds only navigation and view tools". `plan-review.test.tsx` additions "page_comment_on_passage adds a comment for a quote in the plan and refuses one that is not there"; "page_submit_review approve sends approve".

7. **Graph editor tools.** Files: `graph-editor.tsx`, specs, a Zod patch schema per node type in `page-tools.ts` built from `nodeCatalog`. First tests: `graph-editor.test.tsx` additions "page_select selects a node and the inspector shows it"; "page_get_node returns the node's label, type, config and edges"; "page_update_node changes a coder's instructions and marks the graph unsaved, and an unknown key is refused with the known ones"; "page_connect adds an edge the rules allow and refuses one they do not"; "page_save_graph is refused with the issues while the graph is invalid, and otherwise saves as the next version"; "page_remove removes nodes and their edges".

8. **Inbox state, docs and the settings note.** Files: `inbox-page-tools.tsx`, `inbox/page.tsx`, `cards.tsx` (card ids), README "The assistant" section, `assistant-settings.tsx` text for the WebMCP switch. First tests: `components/inbox/inbox-page-tools.test.tsx` "where_am_i on the inbox lists the ids of every card by group"; "page_show_item scrolls a card into view and focuses it, and an unknown id is refused". `inbox-sections.test.tsx` addition "every card carries the id its page tool refers to".

## Risks

| Risk | Mitigation |
|---|---|
| Tool search withholds page tool definitions behind a `ToolSearch` round trip, or hides them | Unverified item 1: read `system/init.tools` in a real turn; set `ENABLE_TOOL_SEARCH=false` in the child environment if `ToolSearch` is present. The page's tool count stays small (at most 12 on the graph editor) and names and descriptions carry the words the person uses ("view", "step", "criterion", "file", "node"). |
| The discovery cache serves a stale tool list for the `handoff` server | `MCP_DISCOVERY_CACHE=0` in the child environment (PR 2); the init line's `tools` is checked by hand once. |
| The model calls a page tool after navigating in the same turn | Decision 7: a plain "the page changed" answer, and the navigation result says the new page's tools arrive on the next message. Open question 2 holds the mid-turn upgrade. |
| The system prompt paragraph never reaches conversations started before this change | The per-message block carries the page every turn; the paragraph only adds the general rule. A new conversation gets it. The same snapshot behaviour already affects the voice variant (Verified facts), reported separately. |
| Two components register the same page kind, or a hot reload registers twice | The last registration wins and the hook logs in production, throws in development. |
| Chrome rejects a page tool registration with `InvalidStateError` during React's development double effect | The page registration awaits the previous abort and catches rejections; the stub reproduces the duplicate-name rejection. |
| A page tool's handler closes over stale state | Handlers are wrapped in `useEffectEvent` so they read the latest state without re-registering. |
| Draft edits by the model surprise the person | Every draft change is visible on the page where it happens, nothing is sent without a confirm tool, and `where_am_i` shows the drafts so the person can ask what changed. The graph editor's "edited, not saved" line and the review's "n comments drafted" count already show it. |
| A hostile criterion or diff line steers the model into a draft comment | The comment is a draft on screen; submission is a confirm card naming the option; no tool leaves the dashboard. |
| Prompt argv grows with long headings | The block holds the path, the heading cut to 120 characters and tool names only. |

## Open questions

Each has a recommended answer; the user decides.

1. Should draft changes (mark a criterion, add a line comment, change a node's setting before saving) run without an approval card? Recommended: yes (Decision 6). They are visible and reversible, and every submission is a confirm tool. Making them confirm would put a card on every click-equivalent and make voice use of the Try it page a chain of yes answers.
2. Should mid-turn page changes be supported now through a stateful MCP session per turn and `notifications/tools/list_changed`? Recommended: not in this plan. Ship the per-turn mechanism, record in the manual verification how often a two-step request ("open the run and show its graph") splits across two messages, and open a follow-up if it is often. The transport change touches the Unverified item of the assistant plan about long HTTP requests under `next dev`.
3. Should the prompt block carry the page's state as well as its tool names, saving a `where_am_i` call per question? Recommended: names only (Decision 3). State is untrusted text from issues and diffs and belongs in a tool result wrapped as data; `where_am_i` costs one call and is cached by the model within the turn.
4. Should the inbox and the run page get page tools that answer questions, decide permissions, repair or cancel, in addition to the catalog's tools? Recommended: no (Decision 5). The catalog tools already do this with approval cards; the pages give `where_am_i` the ids.
5. Should `page_update_node` accept any config key, or only the inspector's fields? Recommended: only the inspector's fields, validated per node type from `nodeCatalog`, with the known keys in the refusal. Arbitrary keys would let the model write config the graph compiler rejects at save, and the person would see the error with no field to fix it in.
6. Should the user message store which page it was asked on? Recommended: yes, `{ kind, path }` only, so the history can later show "asked on the run page" and the test for Open question 2 has data.
7. Should page tools register through WebMCP at all, given a browser agent can click the page? Recommended: yes (Decision 8). The assistant plan decided WebMCP exposes the catalog; the inspector listing a page's tools is the cheapest way to see what the assistant sees, and a browser agent gets the same approval card.

## Verification

Tests and checks:

```bash
pnpm db:up            # not from a worktree while a real run is active
pnpm db:migrate
pnpm test             # unit (page-tools, run-page-tool, prompt, webmcp), integration (turn, turn-mcp, routes), web (provider, pages)
pnpm typecheck && pnpm lint
pnpm doctor:react
```

By hand, with the real CLI and a token in `.env`, `pnpm dev:web` on `http://127.0.0.1:3000`:

1. Open a run page, press `Mod+J`, ask "which tools does this page have". Expect a `where_am_i` row and a reply naming `page_show_view`, `page_open_step` and the steps by key. Read the `system/init` line of that turn from the dashboard's log: record whether `tools` lists `ToolSearch` and whether it lists `mcp__handoff__page_show_view` (Unverified items 1 and 2).
2. Say or type "open graph view". Expect a `page_show_view` row, the Graph tab shown, no navigation, and the reply saying the graph is shown.
3. "Open the coder step." Expect the drawer on the latest coder execution. "Pop it out." Expect the large window. "Close it." Expect both closed.
4. "Cancel this run." Expect a `cancel_run` approval card naming the run id `where_am_i` reported, with no page tool involved. Deny.
5. On a Try it page with three criteria: "the first two work, the third doesn't, the list is empty after a reload". Expect two ticks, the third marked with that note. "Send it back." Expect a `page_submit` card summarizing "Send back to coder: 1 criterion does not work"; approve; the run page opens. With the voice bubble: press `V`, say "approve", expect the card read aloud, say "yes".
6. On a code review: "next file", "show the whole file", "comment on lines 12 to 14 of the migration: missing a down step". Expect the cursor, the mode and a draft comment with the quoted code. "Submit with changes requested." Expect the `page_submit_review` card; approve; the run page opens.
7. On a graph editor: "select the coder and set its instructions to keep commits small". Expect the inspector on the coder with the text, and "edited, not saved". "Save." Expect the `page_save_graph` card; approve; the version increments.
8. In Chrome with `chrome://flags/#enable-webmcp-testing` and the Model Context Tool Inspector: on the run page the inspector lists the catalog plus the five run tools; navigate to the inbox and record whether the list changes without a reload (Unverified item 3); call `page_show_item` from the inspector with a question id and expect the card focused; call `page_submit_review` on a review page and expect the approval card in the panel.
9. Mid-turn change: on the inbox ask "open run <id> and show its graph". Expect `go_to_run`, the run page, a reply saying the page's tools are available from the next message, and a `page_show_view` error if the model tries it anyway. Ask "show the graph" next; expect it to work.
10. Switch WebMCP off in Settings: the inspector lists nothing; the assistant's page tools still work.
