import type { ReactNode } from "react";
import { TrashIcon } from "lucide-react";
import { deleteEntry } from "@/app/library/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, type Crumb } from "@/components/page-header";

const TAB_LABELS = { skills: "Skills", mcp: "MCP servers", agents: "Agents", groups: "Groups" } as const;

/** Layout for a library entry's own page: the trail back to its library tab, title, version and delete, then the form. */
export function EntryPage({
  tab,
  kind,
  title,
  subtitle,
  name,
  version,
  parents,
  children,
}: {
  tab: "skills" | "mcp" | "agents" | "groups";
  kind: "skill" | "mcp" | "agent" | "group";
  title: string;
  subtitle: ReactNode;
  name?: string;
  version?: number;
  /** Steps between the library tab and this page, such as Add skills › an owner. */
  parents?: Crumb[];
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[
          { label: "Library", href: "/library" },
          { label: TAB_LABELS[tab], href: `/library?tab=${tab}` },
          ...(parents ?? []),
          { label: name ?? title },
        ]}
        title={<span className={name ? "font-mono" : undefined}>{title}</span>}
        titleExtra={version !== undefined && <Badge variant="outline">v{version}</Badge>}
        description={subtitle}
        actions={
          name && (
            <form action={deleteEntry}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="name" value={name} />
              <Button type="submit" variant="outline" size="sm" className="text-destructive">
                <TrashIcon data-icon="inline-start" />
                Delete
              </Button>
            </form>
          )
        }
      />
      {children}
    </main>
  );
}
