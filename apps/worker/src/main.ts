import { parseEnv } from "./env.ts";
import { runWorker } from "./app.ts";

try {
  await runWorker(parseEnv(process.env));
} catch (error) {
  console.error(`[worker] ${(error as Error).message}`);
  process.exit(1);
}
