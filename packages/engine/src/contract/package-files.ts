/** Files a package manager writes along with package.json, kept next to it or, in a workspace, at the root. */
export const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"]);
export const WORKSPACE_FILE = "pnpm-workspace.yaml";

export const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
export const baseOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);
