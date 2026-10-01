import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { GET } from "./route";

const shots = vi.hoisted(() => ({ screenshotPath: vi.fn() }));
vi.mock("@/server/screenshots", () => shots);
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

const ID = "9f1c2d3e-0000-4000-8000-000000000001";
const get = (id: string) => GET(new Request(`http://localhost:3000/api/screenshots/${id}`), { params: Promise.resolve({ id }) });

test("a screenshot is served from the file the demo step kept, as an image the browser may cache", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "shots-")), "0-page-1.png");
  writeFileSync(path, "png bytes");
  shots.screenshotPath.mockResolvedValue(path);
  const res = await get(ID);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toContain("immutable");
  expect(await res.text()).toBe("png bytes");
  expect(shots.screenshotPath).toHaveBeenCalledWith({}, ID);
});

test("an unknown screenshot, or one whose file is gone, is not found", async () => {
  expect((await get("not-a-uuid")).status).toBe(404);
  shots.screenshotPath.mockResolvedValue(undefined);
  expect((await get(ID)).status).toBe(404);
  shots.screenshotPath.mockResolvedValue("/nowhere/gone.png");
  expect((await get(ID)).status).toBe(404);
});
