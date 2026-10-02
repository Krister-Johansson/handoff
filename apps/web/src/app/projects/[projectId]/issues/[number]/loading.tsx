import { Skeleton } from "@/components/ui/skeleton";

/** While the project and the issue's runs are read, before the page can say more. */
export default function IssueLoadingPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6 max-sm:px-4">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-7 w-[min(28rem,100%)]" />
      <Skeleton className="h-4 w-[min(36rem,100%)]" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </main>
  );
}
