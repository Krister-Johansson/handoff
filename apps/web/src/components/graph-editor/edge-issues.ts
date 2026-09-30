"use client";

import { createContext, useContext } from "react";

/** Keys of edges the compiler reports an issue for, so they draw red. Empty outside the editor. */
export const InvalidEdgesContext = createContext<ReadonlySet<string>>(new Set());
export const useEdgeInvalid = (id: string) => useContext(InvalidEdgesContext).has(id);
