import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { runPathOf } from "@/server/run-path";

export const dynamic = "force-dynamic";

/** A Try it page by run and question alone, as the assistant opens it; it lives under the run's project. */
export default async function TryItRedirect({ params }: { params: Promise<{ runId: string; questionId: string }> }) {
  const { runId, questionId } = await params;
  const path = await runPathOf(getDb(), runId, questionId, "try");
  if (!path) notFound();
  redirect(path);
}
