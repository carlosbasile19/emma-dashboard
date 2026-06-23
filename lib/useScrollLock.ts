import { useEffect } from "react";

/**
 * Freeze page scroll while `locked` is true (e.g. a drawer/modal is open) so wheel/touch
 * scrolling can't chain through to the body behind the overlay. Compensates for the lost
 * scrollbar width to avoid a horizontal layout shift, and restores the prior styles on close.
 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadRight;
    };
  }, [locked]);
}
