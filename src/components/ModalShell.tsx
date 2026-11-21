'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const openModalStack: string[] = [];
let savedBodyOverflow = '';

/** Responsive bottom-sheet/dialog shell with nested Escape stack and body scroll lock. */
export function ModalShell({
  title,
  headerMeta,
  onClose,
  closeDisabled = false,
  maxWidthClass = 'max-w-lg',
  zIndexClass = 'z-50',
  backdropTestId,
  children,
}: {
  title: ReactNode;
  headerMeta?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidthClass?: string;
  zIndexClass?: string;
  backdropTestId?: string;
  children: ReactNode;
}) {
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openModalStack.length === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openModalStack.push(modalId);

    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
      dialogRef.current.focus();
    }

    return () => {
      const idx = openModalStack.lastIndexOf(modalId);
      if (idx !== -1) {
        openModalStack.splice(idx, 1);
      }
      if (openModalStack.length === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [modalId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !closeDisabled &&
        openModalStack[openModalStack.length - 1] === modalId
      ) {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalId, onClose, closeDisabled]);

  return (
    <div
      data-testid={backdropTestId}
      onClick={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) {
          onClose();
        }
      }}
      className={`fixed inset-0 ${zIndexClass} flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4`}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[90dvh] w-full ${maxWidthClass} overflow-y-auto overscroll-contain rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xl focus:outline-none sm:rounded-2xl sm:p-6`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-[var(--text-primary)] sm:text-lg"
            >
              {title}
            </h2>
            {headerMeta && <div className="mt-2">{headerMeta}</div>}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Закрыть"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
