import { useCallback, useEffect, useEffectEvent, useState } from "react";

/** The nodes a follow keeps in view: those running or waiting on their latest execution. */
export function followTargets(statuses: Record<string, { status: string }>): string[] {
  return Object.entries(statuses)
    .filter(([, s]) => s.status === "running" || s.status === "waiting")
    .map(([key]) => key);
}

/**
 * Follow mode for a live graph: while on, the view moves to the active nodes whenever they change.
 * A move the person makes (one with an event) turns it off; the follow's own moves have none.
 */
export function useFollow(targets: string[], fit: (ids: string[]) => void) {
  const [following, setFollowing] = useState(false);
  const key = targets.join("\n");
  const fitTargets = useEffectEvent(() => {
    if (targets.length > 0) fit(targets);
  });
  useEffect(() => {
    if (following) fitTargets();
  }, [following, key]);
  const toggle = useCallback(() => setFollowing((f) => !f), []);
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) setFollowing(false);
  }, []);
  return { following, toggle, onMoveStart };
}
