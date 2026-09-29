import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://handoff:handoff@localhost:5433/handoff_test";
  process.env.TEST_DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Postgres is not reachable at ${url}. Run \`pnpm db:up\` first.\n${String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}
