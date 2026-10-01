/** A run's page, under the project it belongs to. */
export const runPath = (projectId: string, runId: string) => `/projects/${projectId}/runs/${runId}`;

/** A review question's page, under its run. */
export const reviewPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/review/${questionId}`;

/** A Try it gate's page, where a person checks the run's app against its acceptance criteria. */
export const tryPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/try/${questionId}`;
