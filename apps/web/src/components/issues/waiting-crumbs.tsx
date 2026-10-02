"use client";

import { usePathname } from "next/navigation";
import { useProjectSection } from "@/components/sidebar-section";
import { TopBarCrumbs } from "@/components/top-bar";
import { issueCrumbs, type ProjectRef } from "./issue-crumbs";

/** The trail while the page cannot tell its section yet: the section the sidebar marks, so the two agree. */
export function WaitingCrumbs({ project, number }: { project: ProjectRef; number: number }) {
  const section = useProjectSection(usePathname() ?? "/");
  return <TopBarCrumbs crumbs={issueCrumbs(project, section === "plan" ? "plan" : "issues", `#${number}`)} />;
}
