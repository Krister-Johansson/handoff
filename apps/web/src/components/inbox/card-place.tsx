"use client";

import { createContext, use, type ReactNode } from "react";

/**
 * Where the inbox cards sit: in the Inbox, across projects, each card names its project and run; on a
 * project's page the project goes without saying, so a card names only its run.
 */
type CardPlace = "inbox" | "project";

const CardPlaceContext = createContext<CardPlace>("inbox");

/** The place the surrounding page gives the cards. */
export const useCardPlace = () => use(CardPlaceContext);

/** Cards on one project's page, such as its Home page. */
export function ProjectCards({ children }: { children: ReactNode }) {
  return <CardPlaceContext value="project">{children}</CardPlaceContext>;
}
