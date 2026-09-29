import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">handoff</h1>
        <p className="text-muted-foreground">Graph runs for coding agents: plan, code, pull request, review, merge.</p>
      </div>
      <nav className="flex gap-2">
        <Button asChild>
          <Link href="/runs">Runs</Link>
        </Button>
      </nav>
    </main>
  );
}
