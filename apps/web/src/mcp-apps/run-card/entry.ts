// The run card's script as pnpm build:mcp-apps bundles it into the HTML document (see ../bundle.ts).
import { startRunCard } from "./main";

void startRunCard(document.getElementById("root")!);
