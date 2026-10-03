import { SANDBOX_PROXY_SCRIPT } from "../sandbox-proxy.generated";

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/**
 * The sandbox proxy's page for the dashboard at `hostOrigin`: it names the dashboard, the only frame it hears and
 * answers, and fills its frame with the view.
 */
export function sandboxProxyPage(hostOrigin: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    `<head><meta charset="utf-8"><meta name="handoff-host-origin" content="${attribute(hostOrigin)}"><title>handoff view sandbox</title>`,
    "<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}</style></head>",
    `<body><script>${SANDBOX_PROXY_SCRIPT}</script></body>`,
    "</html>",
    "",
  ].join("\n");
}
