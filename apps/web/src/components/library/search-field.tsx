import type { ComponentProps, ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** An input with an icon inside its start, a search glass unless another icon is given. */
export function SearchField({ icon, className, ...props }: ComponentProps<typeof Input> & { icon?: ReactNode }) {
  return (
    <span className={cn("relative flex min-w-0 items-center", className)}>
      <span aria-hidden className="pointer-events-none absolute left-2.5 flex text-muted-foreground [&_svg]:size-3.5">
        {icon ?? <SearchIcon />}
      </span>
      <Input {...props} className="rounded-md bg-subtle pl-8 dark:bg-subtle" />
    </span>
  );
}
