import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-violet">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="text-violet underline underline-offset-4">
        Back to dashboard
      </Link>
    </main>
  );
}
