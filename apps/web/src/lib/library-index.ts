import { cache } from "react";
import { listLibraryIndex } from "@handoff/db";
import { getDb } from "@/lib/db";

/** Every library entry by kind, read once per request however many parts of a page ask. */
export const libraryIndex = cache(() => listLibraryIndex(getDb()));
