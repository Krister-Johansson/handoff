import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    overrides: [
      {
        // shadcn/ui generated components export their cva variants next to the component by design.
        files: ["src/components/ui/**"],
        rules: ["react-doctor/only-export-components", "react-doctor/no-array-index-as-key"],
      },
      {
        // The route delegates to handleGitHubWebhook, which verifies X-Hub-Signature-256 before
        // reading the payload (see src/server/github-webhook.integration.test.ts).
        files: ["src/app/api/webhooks/github/route.ts"],
        rules: ["react-doctor/webhook-signature-risk"],
      },
      {
        // The MCP Apps sandbox proxy's frame. The specification (2026-01-26, "Sandbox proxy") requires
        // allow-scripts and allow-same-origin on it; its document comes from another origin (a port of its own,
        // src/server/mcp-apps-sandbox.ts), so it cannot reach the dashboard, and the view inside it runs with
        // allow-scripts only.
        files: ["src/components/assistant/app-view.tsx"],
        rules: ["react-doctor/iframe-missing-sandbox"],
      },
    ],
  },
});
