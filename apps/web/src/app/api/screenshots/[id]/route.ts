import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getDb } from "@/lib/db";
import { screenshotPath } from "@/server/screenshots";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** A screenshot a Demo step took, read from the file the worker kept. A screenshot never changes, so it caches for good. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const path = await screenshotPath(getDb(), id);
  const type = path ? TYPES[extname(path).toLowerCase()] : undefined;
  if (!path || !type) return Response.json({ error: "not found" }, { status: 404 });
  const body = await readFile(path).catch(() => undefined);
  if (!body) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "private, max-age=31536000, immutable" } });
}
