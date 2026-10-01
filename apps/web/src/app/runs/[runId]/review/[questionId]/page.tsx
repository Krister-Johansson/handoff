import { notFound, permanentRedirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { runPathOf } from "@/server/run-path";

export const dynamic = "force-dynamic";

/** Reviews live under their run in its project; links from before that land here. */
export default async function OldReviewPage({ params }: { params: Promise<{ runId: string; questionId: string }> }) {
  const { runId, questionId } = await params;
  const path = await runPathOf(getDb(), runId, questionId);
  if (!path) notFound();
  permanentRedirect(path);
}
