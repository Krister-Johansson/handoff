"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { markNotificationsRead } from "@/server/notifications";

/** Marks every notification so far as read. */
export async function markAllReadAction() {
  await markNotificationsRead(getDb(), new Date());
  revalidatePath("/notifications");
}
