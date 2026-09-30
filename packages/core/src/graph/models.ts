/** Claude Code's --effort levels. A model that lacks one falls back to the highest level it has below it. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * Claude Code's model aliases, which resolve to the newest model of each family for the account. A
 * node can also name a full model id such as claude-opus-5-5.
 */
export const MODEL_ALIASES = [
  { alias: "best", label: "Best available (Fable, else Opus)" },
  { alias: "fable", label: "Fable: hardest, longest tasks" },
  { alias: "opus", label: "Opus: complex reasoning" },
  { alias: "sonnet", label: "Sonnet: everyday coding" },
  { alias: "haiku", label: "Haiku: fast and simple" },
  { alias: "opus[1m]", label: "Opus with a 1M token context" },
  { alias: "sonnet[1m]", label: "Sonnet with a 1M token context" },
] as const;

/** An alias or a model id: letters, digits, dots, dashes, underscores, @ and a [1m] style suffix. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._@:-]*(\[[0-9a-z]+\])?$/;

export const isEffortLevel = (value: unknown): value is EffortLevel => typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
export const isModelName = (value: unknown): value is string => typeof value === "string" && value.length <= 100 && MODEL_NAME.test(value);

/** Levels of Claude Code's local code review. ultra is a billed cloud review that only a person can start. */
export const REVIEW_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const DEFAULT_REVIEW_LEVEL = "high";
export const isReviewLevel = (value: unknown) => typeof value === "string" && (REVIEW_LEVELS as readonly string[]).includes(value);
