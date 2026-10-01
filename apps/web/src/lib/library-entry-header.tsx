import type { ReactNode } from "react";
import type { Crumb } from "@/components/page-header";
import { Tag } from "@/components/library/tag";
import { libraryIndex } from "@/lib/library-index";

type Tab = "skills" | "mcp" | "agents" | "groups";
export type Kind = "skill" | "mcp" | "agent" | "group";

const TAB_LABELS: Record<Tab, string> = { skills: "Skills", agents: "Agents", mcp: "MCP servers", groups: "Groups" };
const SOURCE_LABEL = { "skills.sh": "skills.sh", github: "GitHub", local: "Written here" } as const;

export type EntryHeader = { crumbs: Crumb[]; title: ReactNode; titleExtra?: ReactNode; description: ReactNode };

export type EntryHeaderInput = {
  tab: Tab;
  title: string;
  subtitle: ReactNode;
  /** The entry's name, on an existing entry's own page. */
  name?: string;
  version?: number;
  /** Where a skill came from; shown next to its version. */
  source?: keyof typeof SOURCE_LABEL;
  /** Steps between the library tab and this page, such as Add skills › an owner. */
  parents?: Crumb[];
};

/**
 * The header of a library page: the trail back to its tab (with a menu of the other tabs) and, on an
 * entry's own page, a menu of the other entries of its kind; then the title, version and source.
 */
export async function entryHeader({ tab, title, subtitle, name, version, source, parents }: EntryHeaderInput): Promise<EntryHeader> {
  const siblings = name ? (await libraryIndex())[tab] : [];
  return {
    crumbs: [
      { label: "Library", href: "/library" },
      {
        label: TAB_LABELS[tab],
        href: `/library?tab=${tab}`,
        menuLabel: "library tabs",
        menu: (Object.keys(TAB_LABELS) as Tab[]).map((t) => ({ label: TAB_LABELS[t], href: `/library?tab=${t}`, current: t === tab })),
      },
      ...(parents ?? []),
      name
        ? {
            label: name,
            menuLabel: TAB_LABELS[tab].toLowerCase(),
            menu: siblings.map((s) => ({ label: s.name, href: `/library/${tab}/${encodeURIComponent(s.name)}`, current: s.name === name, hint: `v${s.version}` })),
          }
        : { label: title },
    ],
    title: <span className={name ? "font-mono text-xl" : undefined}>{title}</span>,
    titleExtra: (version !== undefined || source) && (
      <>
        {version !== undefined && <Tag mono>v{version}</Tag>}
        {source && <Tag>{SOURCE_LABEL[source]}</Tag>}
      </>
    ),
    description: subtitle,
  };
}

