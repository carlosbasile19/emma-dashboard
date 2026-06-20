"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-ink/60">
        An unexpected error occurred. Try again, and if it keeps happening, refresh
        the page.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}
