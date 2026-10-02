import { afterEach, expect, inject, test } from "vitest";
import { createDb } from "../client.ts";
import setup from "./global-setup.ts";
import { testDatabaseUrl } from "./test-db.ts";

const saved = process.env.TEST_DATABASE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = saved;
});

function fakeProject() {
  const provided: Record<string, unknown> = {};
  return { provided, provide: (key: "testDatabaseUrl", value: string) => void (provided[key] = value) };
}

async function tables(url: string): Promise<string[]> {
  const db = createDb(url);
  try {
    const { rows } = await db.$client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('projects', 'runs') order by table_name",
    );
    return rows.map((r) => r.table_name);
  } finally {
    await db.$client.end();
  }
}

test("without TEST_DATABASE_URL, two global setups each start their own migrated Postgres and stop it on teardown", async () => {
  delete process.env.TEST_DATABASE_URL;
  const a = fakeProject();
  const b = fakeProject();
  const [stopA, stopB] = await Promise.all([setup(a), setup(b)]);
  const urlA = a.provided.testDatabaseUrl as string;
  const urlB = b.provided.testDatabaseUrl as string;
  try {
    expect(urlA).toMatch(/^postgres(ql)?:\/\//);
    expect(urlB).not.toBe(urlA);
    expect(urlA).not.toContain(":5433/");
    expect(await tables(urlA)).toEqual(["projects", "runs"]);
    expect(await tables(urlB)).toEqual(["projects", "runs"]);
  } finally {
    await Promise.all([stopA(), stopB()]);
  }
  await expect(tables(urlA)).rejects.toThrow();
}, 120_000);

test("TEST_DATABASE_URL overrides the container: the setup migrates and provides that database", async () => {
  process.env.TEST_DATABASE_URL = testDatabaseUrl();
  const project = fakeProject();
  const stop = await setup(project);
  await stop();
  expect(project.provided.testDatabaseUrl).toBe(testDatabaseUrl());
  expect(await tables(testDatabaseUrl())).toEqual(["projects", "runs"]);
});

test("the suite's tests use the database the global setup provided", () => {
  expect(testDatabaseUrl()).toBe(inject("testDatabaseUrl"));
});
