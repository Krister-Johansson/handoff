/** A run's page, under the project it belongs to. */
export const runPath = (projectId: string, runId: string) => `/projects/${projectId}/runs/${runId}`;

/** A review question's page, under its run. */
export const reviewPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/review/${questionId}`;
