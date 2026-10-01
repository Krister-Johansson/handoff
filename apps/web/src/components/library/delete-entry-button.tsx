import { Trash2Icon } from "lucide-react";
import { deleteEntry } from "@/app/library/actions";
import { Button } from "@/components/ui/button";

/** Deletes a library entry and goes back to its tab. */
export function DeleteEntryButton({ kind, name }: { kind: "skill" | "mcp" | "agent" | "group"; name: string }) {
  return (
    <form action={deleteEntry}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="name" value={name} />
      <Button type="submit" variant="outline" className="text-danger hover:bg-danger-bg hover:text-danger">
        <Trash2Icon data-icon="inline-start" />
        Delete
      </Button>
    </form>
  );
}
