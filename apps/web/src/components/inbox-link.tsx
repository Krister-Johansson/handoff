import { connection } from "next/server";
import { Suspense } from "react";
import { NavLink } from "@/components/nav-link";
import { getDb } from "@/lib/db";
import { inboxCount } from "@/server/inbox";

async function InboxCount() {
  await connection();
  const count = await inboxCount(getDb()).catch(() => 0);
  return count > 0 ? (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger-dot px-1.5 text-[11px] font-semibold text-white tabular-nums">{count}</span>
  ) : null;
}

/** Inbox nav link with the number of open questions and failed runs, rendered per request. */
export function InboxLink() {
  return (
    <NavLink href="/inbox">
      Inbox
      <Suspense fallback={null}>
        <InboxCount />
      </Suspense>
    </NavLink>
  );
}
