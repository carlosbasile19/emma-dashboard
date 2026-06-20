"use client";

import { ErrorState } from "@/components/ui/states/ErrorState";

// Dashboard-scoped error boundary — keeps the sidebar/header shell and shows a recoverable
// error within the content area for any unexpected render error in a dashboard view.
export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      copy={{
        title: "Something went wrong",
        body: "We hit an unexpected error loading this view. Give it another go.",
      }}
      onRetry={reset}
    />
  );
}
