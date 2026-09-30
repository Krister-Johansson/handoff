/** The kinds of library entry a node or project can enable. */
export type LibraryKind = "groups" | "skills" | "mcp" | "agents";
/** Library entries by name, per kind, as nodes and projects store them. */
export type LibrarySelection = Record<LibraryKind, string[]>;
/** One entry to choose, with a line about it and, for skills, the repository it came from. */
export type LibraryEntry = { name: string; detail: string; source?: string };
/** Everything in the library, per kind, for a chooser. */
export type LibraryChoices = Record<LibraryKind, LibraryEntry[]>;
