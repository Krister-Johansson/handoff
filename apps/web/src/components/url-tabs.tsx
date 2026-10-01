"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

/** Tabs whose choice lives in the URL as ?tab=, so a refresh, a link or the breadcrumb keeps it. Other search params stay. */
export function UrlTabs({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Tabs
      defaultValue={value}
      onValueChange={(tab) => {
        const params = new URLSearchParams(window.location.search);
        params.set("tab", tab);
        router.replace(`?${params.toString()}`, { scroll: false });
      }}
      className={className}
    >
      {children}
    </Tabs>
  );
}
