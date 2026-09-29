import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { inboxCount } from "@/server/inbox";

async function InboxCount() {
  await connection();
  const count = await inboxCount(getDb()).catch(() => 0);
  return count > 0 ? <Badge variant="destructive">{count}</Badge> : null;
}

/** Inbox nav link with the number of open questions and failed runs, rendered per request. */
export function InboxLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/inbox">
        Inbox
        <Suspense fallback={null}>
          <InboxCount />
        </Suspense>
      </Link>
    </Button>
  );
}
