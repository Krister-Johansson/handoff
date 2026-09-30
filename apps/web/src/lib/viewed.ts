import type { DiffFile } from "@handoff/core";

export type View = { path: string; blobSha: string; viewedAt: Date };
export type ViewState = { viewed: true } | { viewed: false; reason?: "changed" | "commented" };

/**
 * Whether a person has viewed this version of a file. A mark holds while the file keeps the blob it
 * had, and while no comment from an earlier round of the review is newer than the mark: a file the
 * coder changed, or one the person commented on last round, needs another look.
 */
export function viewState(file: DiffFile, views: View[], commentedAt: Record<string, Date>): ViewState {
  if (!file.blob) return { viewed: false };
  const mark = views.find((v) => v.path === file.path && v.blobSha === file.blob);
  if (!mark) return views.some((v) => v.path === file.path) ? { viewed: false, reason: "changed" } : { viewed: false };
  const commented = commentedAt[file.path];
  return commented && mark.viewedAt <= commented ? { viewed: false, reason: "commented" } : { viewed: true };
}
