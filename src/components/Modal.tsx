import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  ariaLabel: string;
  testId: string;
  closeTestId: string;
  maxWidthClass?: string;
  headerExtra?: ReactNode;
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/** Accessible overlay modal with focus management, Escape/backdrop dismissal, and FP input pausing. */
export function Modal({
  title,
  ariaLabel,
  testId,
  closeTestId,
  maxWidthClass = 'max-w-2xl',
  headerExtra,
  onClose,
  onOpenChange,
  children,
}: ModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onCloseRef.current = onClose;
    onOpenChangeRef.current = onOpenChange;
  });

  useEffect(() => {
    const prevFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenChangeRef.current?.(true);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      onOpenChangeRef.current?.(false);
      if (prevFocused?.isConnected) prevFocused.focus();
    };
  }, []);

  return (
    <div className="ubs-pad-safe pointer-events-auto fixed inset-0 z-30 flex items-center justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${ariaLabel}`}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-sky-950/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-testid={testId}
        className={`ubs-scroll relative z-10 flex max-h-full w-full ${maxWidthClass} flex-col gap-3 rounded-3xl bg-sky-50 p-4 shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black">{title}</h2>
            {headerExtra}
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid={closeTestId}
            aria-label="Close"
            onClick={onClose}
            className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-md active:scale-95"
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
