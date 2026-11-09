import { useEffect, type RefObject } from "react";

/**
 * Keep focus inside an open dialog. Esc handling stays with the caller.
 * Active only while the dialog is rendered/open.
 */
export function useDialogFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const trigger = document.activeElement as HTMLElement | null;
    const selector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
    const timer = window.setTimeout(() => {
      node.querySelectorAll<HTMLElement>(selector)[0]?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = node.querySelectorAll<HTMLElement>(selector);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [active, ref]);
}
