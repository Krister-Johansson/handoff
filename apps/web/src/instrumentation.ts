/** Runs once when the dashboard's server starts: says so in the log when GitHub credentials are missing. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { gitHubCredentialsWarning } = await import("./lib/startup-checks");
  const warning = gitHubCredentialsWarning(process.env);
  if (warning) console.warn(warning);
}
