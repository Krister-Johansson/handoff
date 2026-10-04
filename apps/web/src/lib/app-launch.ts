/** Claude Code desktop's page on .claude/launch.json. */
export const LAUNCH_DOCS_URL = "https://code.claude.com/docs/en/desktop";

/** Docker workspace mode as the pages describe it: the image the containers come from, and the Engine's version when Docker answered. */
export type DockerMode = { image: string; engine: string | null };

/** Before Docker Engine 28, ports published on localhost may be reachable from the same network segment. */
const SAFE_ENGINE_MAJOR = 28;

/**
 * The warning for a Docker Engine older than 28, or undefined for 28 and later or a version Docker did
 * not report. Previews still start; the person decides.
 */
export function engineWarning(engine: string | null): string | undefined {
  const major = Number(/^(\d+)\./.exec(engine ?? "")?.[1]);
  if (!Number.isInteger(major) || major >= SAFE_ENGINE_MAJOR) return undefined;
  return `Docker Engine ${engine} is older than 28, so other machines on your network may reach ports published on 127.0.0.1. Update Docker to 28 or later.`;
}

/** What App launch says in Docker workspace mode; the last sentence only with a compose file. */
export function dockerLaunchNote(docker: DockerMode, composeFile: string | undefined): string {
  const note =
    `Steps run in Docker containers from ${docker.image}. ` +
    "The app runs in its own container from that image, published on 127.0.0.1 only, and must listen on 0.0.0.0.";
  return composeFile ? `${note} It reaches the services in ${composeFile} at the same localhost ports as on this machine.` : note;
}
