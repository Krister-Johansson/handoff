import { cn } from "@/lib/utils";

/** One block of the editor's side panel: a small uppercase heading, an optional action on its right, and a rule below. */
export function InspectorSection({ title, aside, className, children }: { title?: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3 border-b px-4 py-3.5 last:border-b-0", className)}>
      {title && (
        <div className="flex min-h-5 items-center gap-2">
          <h3 className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">{title}</h3>
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
