import { redirect } from "next/navigation";
import { PROJECTS_SETTINGS_PATH } from "@/lib/paths";

/** Projects are managed in Settings, Projects; the old projects page sends its links there. */
export default function ProjectsPage(): never {
  redirect(PROJECTS_SETTINGS_PATH);
}
