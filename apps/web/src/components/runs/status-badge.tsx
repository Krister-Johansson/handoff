import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/lib/status";

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusTone(status)}>{status}</Badge>;
}
