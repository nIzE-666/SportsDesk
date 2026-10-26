import { useEffect, useRef, type RefObject } from 'react';
export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ].filter((e) => !e.closest('[hidden]'));
    const initial = () => {
      (focusable()[0] ?? panel).focus();
    };
    initial();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (!first) {
          e.preventDefault();
          panel.focus();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first || !panel.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !panel.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const focus = (e: FocusEvent) => {
      if (!panel.contains(e.target as Node)) initial();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focus);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, open]);
}
