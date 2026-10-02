/** The files a person allows outside the plan, from a list separated by commas or new lines. */
export function allowPathsOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ];
}
