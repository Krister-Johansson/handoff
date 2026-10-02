/** Where a person sees a change in the app, when a project lists no UI paths: routes, pages, components and styles. */
export const DEFAULT_UI_PATHS = [
  "**/app/**",
  "**/pages/**",
  "**/routes/**",
  "**/components/**",
  "**/styles/**",
  "**/*.{css,scss,sass,less}",
  "**/*.{tsx,jsx,vue,svelte,html}",
] as const;

/** A project's UI paths, or the defaults when it lists none. */
export const uiPathsOf = (paths: readonly string[] | null | undefined): string[] => (paths?.length ? [...paths] : [...DEFAULT_UI_PATHS]);
