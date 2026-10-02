/** "1 worker online", or "No worker running". */
export const workerLabel = (live: number) => (live > 0 ? `${live} ${live === 1 ? "worker" : "workers"} online` : "No worker running");
