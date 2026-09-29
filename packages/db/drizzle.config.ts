import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://handoff:handoff@localhost:5433/handoff" },
});
