# Sidebar: a shadcn app shell with project routes

## Context

The dashboard's top bar has three links (Projects, Inbox, Library), and a project's pages are tabs on one route (`/projects/<id>?tab=runs|issues|pulls|graphs|settings`, `apps/web/src/lib/project-tab.ts`). The Plan page, its board and timeline, and a project Overview are on the way, and a tab row does not hold them. The user approved a shadcn Sidebar shell, designed in Claude Design (project "handoff dashboard", folder `shell/`: `App shell.dc.html`, `Shell pages.dc.html`, `Shell mobile and panels.dc.html`, `Sidebar.dc.html`, `brief.md`) and a project Overview (`shell/Project overview.dc.html`, in progress).

## Decisions

Approved by the user on 2026-10-02.

1. The shell is the shadcn Sidebar, Radix variant (the project's style is `radix-nova`): `SidebarProvider`, `Sidebar collapsible="icon"`, `SidebarInset`, `SidebarTrigger`, with its open state in the shadcn cookie. It is 256 px open, 48 px as icons and a 288 px sheet on mobile.
2. The sidebar header holds the handoff logo and a project switcher (letter tile, name, repository). Its menu lists the other projects, then "Add project" and "Manage projects". Picking a project keeps the page type. Outside a project the switcher shows the last project used, kept in a cookie.
3. Project group, each a route: Overview (`/projects/<id>`), Runs, Plan, Issues, Pull requests, Graphs, Project settings (`/projects/<id>/runs`, `/plan`, `/issues`, `/pulls`, `/graphs`, `/settings`). Old `?tab=` links redirect. Runs shows a count of active runs.
4. Second group: Inbox with its count, and Library. Notifications stays the bell only. Collapsed, Inbox shows a dot when it has items.
5. Footer: Settings and the worker status, which opens Settings.
6. Top bar in the inset: the trigger and the page breadcrumb on the left; voice, assistant and the notification bell on the right. One-crumb trails show.
7. `/` goes to the last project's Overview, or to Settings, Projects when there is none.
8. Managing projects (add, edit repository, branch, setup command and plan link, delete) moves to Settings, Projects, the first section there. `/projects` redirects to it. Project settings keeps the default graph and the default library.
9. The Runs page carries the old project header (repository, branch, graph, Edit graph, New run).
10. The graph editor collapses the sidebar when it opens. Cmd/Ctrl+B is ignored while typing in a text field. A "Skip to content" link comes first in the tab order.
11. From 1280 px wide the assistant panel docks under the top bar and the page narrows beside it; below that it stays a sheet. The voice bubble centres on the page column.
12. Voice moves from V to Ctrl+M on every system (Control on Mac too; Cmd+M minimizes). Neither Google's Chrome shortcut list nor Apple's macOS list uses it. It works while typing: with the assistant panel open it dictates into the message box, otherwise it opens the bubble. Escape keeps its current meaning.

## Delivery

One issue, one branch and one PR per step, CI green, `pnpm doctor:react` clean, a red-green slice per test named here, and Context7 before code against Next.js, shadcn or React. Steps 2 and 4 can run in parallel after step 1.

1. **Shell and project routes.** Files: `components/ui/sidebar.tsx` (from the shadcn CLI) and its hooks, `components/app-sidebar.tsx`, `components/project-switcher.tsx`, `components/top-bar.tsx`, `app/layout.tsx`, `components/site-header.tsx` (removed), `page-header.tsx`, `app/projects/[projectId]/{page,runs,issues,pulls,graphs,settings}`, `lib/project-tab.ts`, `lib/paths.ts`, `lib/assistant/ui-tools.ts` and `catalog.ts` (`set_project_tab` becomes navigation to the route), `app/page.tsx`. `/projects/<id>` redirects to Runs until step 3. First tests: `app-sidebar.test.tsx` "the project group links to each project route and marks the current one"; "outside a project the switcher shows the last project from the cookie"; "picking another project keeps the page type"; "collapsed, Inbox shows a dot when it has items"; `top-bar.test.tsx` "the breadcrumb shows one crumb on Inbox"; `sidebar-shortcut.test.tsx` "Cmd/Ctrl+B toggles the sidebar and is ignored in a text field"; `project-routes.test.ts` "an old ?tab= link redirects to its route"; `ui-tools.test.ts` "set_project_tab navigates to the tab's route"; `layout.test.tsx` "Skip to content is the first tab stop".
2. **Settings, Projects.** Files: `app/settings/page.tsx`, `components/settings/projects-settings.tsx`, `app/projects/page.tsx` (redirect), `app/projects/actions.ts`, project settings route narrowed. First tests: `projects-settings.test.tsx` "lists projects and expands one to show repository, branch, setup command and plan link"; "Add project opens the add form"; "Delete asks first"; `project-routes.test.ts` "/projects redirects to Settings, Projects"; `project-settings.test.tsx` "project settings shows only the default graph and library".
3. **Project Overview.** After the user approves the Overview design. Files: `app/projects/[projectId]/page.tsx`, `components/overview/*`, a server read in `server/overview.ts`. Tests follow the approved frames.
4. **Docked assistant and voice on Ctrl+M.** Files: `components/assistant/assistant-sheet.tsx`, `app/layout.tsx`, `components/voice/voice-hotkeys.tsx`, `voice-provider.tsx`, the composer, the keys shown in the Empty state and settings. First tests: `assistant-sheet.test.tsx` "from 1280 px the panel docks and the page narrows; below it is a sheet"; `voice-hotkeys.test.tsx` "Ctrl+M opens the bubble"; "Ctrl+M with the panel open dictates into the composer"; "Ctrl+M works while typing"; "V no longer starts voice"; "Cmd+M is left to the system".

## Open questions

- Whether a page can take Ctrl+M from Chrome on Windows and Linux desktops and with screen readers running. No shortcut list covers it; step 4 checks it in Chrome on each system.
