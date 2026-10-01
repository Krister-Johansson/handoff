"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

/** Tabs whose choice lives in the URL as ?tab=, so a refresh, a link or the breadcrumb keeps it. */
export function UrlTabs({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Tabs
      defaultValue={value}
      onValueChange={(tab) => router.replace(`?tab=${tab}`, { scroll: false })}
      className={className}
    >
      {children}
    </Tabs>
  );
}
