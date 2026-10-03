import { redirect } from "next/navigation";
import { libraryRedirectPath } from "@/lib/settings-tab";

/** The library is four sections of Settings now; an old /library link lands on its section, search and all. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(libraryRedirectPath(await searchParams));
}
