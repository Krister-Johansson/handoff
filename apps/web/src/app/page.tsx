import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>handoff</h1>
      <nav>
        <Link href="/runs">Runs</Link>
      </nav>
    </main>
  );
}
