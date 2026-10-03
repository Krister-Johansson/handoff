import { FilterLinks } from "@/components/filter-links";
import { runsPath } from "@/lib/paths";
import { RUNS_FILTERS, type RunsFilter } from "@/lib/run-status-filter";
import type { RunsCounts } from "@/server/project-runs";

/** All, Active, Waiting, Failed and Done as links with counts; the filter lives in ?status=. */
export function RunFilters({ projectId, active, counts }: { projectId: string; active: RunsFilter | undefined; counts: RunsCounts }) {
  return (
    <FilterLinks
      label="Run status"
      links={[
        { href: runsPath(projectId), label: "All", count: counts.all, current: active === undefined },
        ...RUNS_FILTERS.map((f) => ({ href: runsPath(projectId, f.value), label: f.label, count: counts[f.value], current: f.value === active })),
      ]}
    />
  );
}
