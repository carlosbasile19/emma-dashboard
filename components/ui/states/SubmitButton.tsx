"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit control for server-action forms.
 *
 * MUST be rendered inside the <form> it belongs to — useFormStatus reads the nearest enclosing
 * form's submission, and returns a permanent `pending: false` if called from the component that
 * *renders* the form rather than a child of it.
 *
 * Disables on submit, which also prevents the double-submit that silent buttons invite.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  title,
}: {
  children: ReactNode;
  /** Omit for icon-only buttons — the icon stays and the disabled state carries the signal. */
  pendingLabel?: ReactNode;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`${className ?? ""} disabled:cursor-default disabled:opacity-60`}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
