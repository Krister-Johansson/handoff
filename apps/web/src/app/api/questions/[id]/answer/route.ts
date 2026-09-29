import { getDb } from "@/lib/db";
import { handleAnswer } from "@/server/answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAnswer(getDb(), id, request);
}
