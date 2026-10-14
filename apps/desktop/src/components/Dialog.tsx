import { ReactNode, useEffect, useRef } from "react";

type DialogProps = {
  className: string;
  labelledBy?: string;
  label?: string;
  onClose?: () => void;
  /** Close when the dimmed backdrop is clicked (default: true if closable). */
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  children: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal: moves focus inside, keeps Tab within the dialog, closes
 * on Escape (when closable) and returns focus to where it was on close.
 */
export function Dialog({
  className,
  labelledBy,
  label,
  onClose,
  closeOnBackdrop = true,
  backdropClassName = "",
  children,
}: DialogProps) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!node) return;
      if (event.key === "Escape" && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem?.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem?.focus();
      }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className={`modal-backdrop ${backdropClassName}`}
      role="presentation"
      onMouseDown={() => {
        if (closeOnBackdrop) onClose?.();
      }}
    >
      <section
        ref={ref}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
