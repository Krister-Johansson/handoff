"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** The settings read this browser's storage and notification permission, so they render in the browser only. */
export const NotificationSettingsLoader = dynamic(() => import("./notification-settings").then((m) => m.NotificationSettings), {
  ssr: false,
  loading: () => <Skeleton className="h-40 max-w-md" />,
});
