import { notFound, permanentRedirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { runPathOf } from "@/server/run-path";

export const dynamic = "force-dynamic";

/** Runs live under their project; links from before that (PR bodies, notifications) land here. */
export default async function OldRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const path = await runPathOf(getDb(), runId);
  if (!path) notFound();
  permanentRedirect(path);
}
