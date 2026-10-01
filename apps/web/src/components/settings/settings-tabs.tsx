"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsTab } from "@/lib/settings-tab";

/** Appearance, Notifications and Claude Code; the server renders only the active tab, chosen by ?tab=. */
export function SettingsTabs({ active, children }: { active: SettingsTab; children: ReactNode }) {
  const router = useRouter();
  return (
    <Tabs value={active} onValueChange={(tab) => router.push(`?tab=${tab}`, { scroll: false })} className="gap-4">
      <TabsList variant="line">
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="agents">Claude Code</TabsTrigger>
      </TabsList>
      <TabsContent value={active}>{children}</TabsContent>
    </Tabs>
  );
}
