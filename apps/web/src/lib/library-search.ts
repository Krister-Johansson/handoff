/** Whether a library entry's fields (name, description, members) hold every word of the search, ignoring case. */
export function matchesLibrarySearch(fields: string[], query: string | undefined): boolean {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const text = fields.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
