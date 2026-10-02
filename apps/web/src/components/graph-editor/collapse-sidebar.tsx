"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Collapses the sidebar to icons while the graph editor is open, so the canvas gets the width, and
 * opens it again on the way out when it was open on the way in.
 */
export function CollapseSidebar() {
  const { open, setOpen } = useSidebar();
  const wasOpen = useRef(open);
  const setSidebar = useEffectEvent((value: boolean) => setOpen(value));
  useEffect(() => {
    if (!wasOpen.current) return;
    setSidebar(false);
    return () => setSidebar(true);
  }, []);
  return null;
}
