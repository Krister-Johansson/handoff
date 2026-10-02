import { ListOrderedIcon } from "lucide-react";
import { Tag } from "@/components/tag";

const PLACE = ["next", "second", "third"];

/** "Next 1" to "Next 3" on a Ready task the scheduler starts next, in its order. */
export function NextTag({ place }: { place: number | undefined }) {
  if (place === undefined) return null;
  return (
    <Tag title={`The scheduler starts it ${PLACE[place - 1] ?? `${place}th`}`}>
      <ListOrderedIcon aria-hidden />
      Next {place}
    </Tag>
  );
}
