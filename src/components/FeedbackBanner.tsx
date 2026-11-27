'use client';

export type FeedbackState = { kind: 'error' | 'success'; message: string } | null;

/** Shared inline error/success banner used across management forms and modals. */
export function FeedbackBanner({ feedback }: { feedback: FeedbackState }) {
  if (!feedback) return null;
  const isError = feedback.kind === 'error';

  return (
    <p
      role={isError ? 'alert' : 'status'}
      style={{
        backgroundColor: isError ? 'var(--status-repair-bg)' : 'var(--status-rent-bg)',
        borderColor: isError ? 'var(--status-repair-border)' : 'var(--status-rent-border)',
        color: isError ? 'var(--status-repair-text)' : 'var(--status-rent-text)',
      }}
      className="rounded-lg border px-3 py-2 text-xs font-medium sm:text-sm"
    >
      {feedback.message}
    </p>
  );
}
