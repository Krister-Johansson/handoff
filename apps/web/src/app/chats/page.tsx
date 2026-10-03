import { ChatsTable, NewChatButton } from "@/components/assistant/chats-page";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/lib/db";
import { listProjects } from "@/server/graphs";

export const dynamic = "force-dynamic";

/** Every chat with the assistant, across projects; the sidebar's View all opens it. */
export default async function ChatsPage() {
  const projects = await listProjects(getDb()).catch(() => []);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Chats" }]}
        title="Chats"
        description="Your conversations with the assistant, across projects. Pinned chats are kept; the others go after 30 days without use."
        actions={<NewChatButton />}
      />
      <ChatsTable projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
    </main>
  );
}
