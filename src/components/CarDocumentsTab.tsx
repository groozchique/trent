'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { CAR_DOCUMENT_TYPES, type CarDocumentType } from '@/db/schema';
import { readApiError } from '@/lib/api-client';
import { CAR_DOCUMENT_LABELS, type CarDeadlineSummary, type DeadlineState } from '@/lib/deadlines';
import { formatMileage } from '@/lib/format';
import {
  upsertDocumentsSchema,
  type CarDetailDto,
  type CarDocumentDto,
} from '@/lib/validation';
import { FeedbackBanner, type FeedbackState } from './FeedbackBanner';

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

const PRIMARY_BTN_CLASS =
  'inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

type DocDraft = {
  expiresAt: string;
  policyNumber: string;
  notes: string;
};

type DocDraftMap = Record<CarDocumentType, DocDraft>;

const DEADLINE_BADGE_META: Record<DeadlineState, { label: string; style: CSSProperties }> = {
  ok: {
    label: 'В норме',
    style: {
      backgroundColor: 'var(--status-available-bg)',
      borderColor: 'var(--status-available-border)',
      color: 'var(--status-available-text)',
    },
  },
  warning: {
    label: 'Истекает',
    style: {
      backgroundColor: 'var(--status-overdue-bg)',
      borderColor: 'var(--status-overdue-border)',
      color: 'var(--status-overdue-text)',
    },
  },
  expired: {
    label: 'Просрочено',
    style: {
      backgroundColor: 'var(--status-repair-bg)',
      borderColor: 'var(--status-repair-border)',
      color: 'var(--status-repair-text)',
    },
  },
};

function DeadlineBadge({ status }: { status: DeadlineState }) {
  const meta = DEADLINE_BADGE_META[status];
  return (
    <span
      data-deadline-status={status}
      style={meta.style}
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap"
    >
      {meta.label}
    </span>
  );
}

function formatDateHint(daysLeft: number): string | null {
  if (daysLeft < 0) return `просрочено на ${Math.abs(daysLeft)} дн.`;
  if (daysLeft === 0) return 'сегодня';
  if (daysLeft <= 14) return `осталось ${daysLeft} дн.`;
  return null;
}

function buildDocDrafts(documents: CarDocumentDto[]): DocDraftMap {
  const byType = new Map(documents.map((doc) => [doc.type, doc]));
  return Object.fromEntries(
    CAR_DOCUMENT_TYPES.map((type) => {
      const doc = byType.get(type);
      return [
        type,
        {
          expiresAt: doc?.expiresAt ?? '',
          policyNumber: doc?.policyNumber ?? '',
          notes: doc?.notes ?? '',
        },
      ];
    }),
  ) as DocDraftMap;
}

/** Tab for vehicle service schedule (mileage/date) and 4 mandatory/optional document types. */
export function CarDocumentsTab({
  car,
  onCarUpdated,
}: {
  car: CarDetailDto;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const [nextServiceMileage, setNextServiceMileage] = useState(() =>
    car.nextServiceMileage !== null ? String(car.nextServiceMileage) : '',
  );
  const [nextServiceDate, setNextServiceDate] = useState(() => car.nextServiceDate ?? '');
  const [docDrafts, setDocDrafts] = useState<DocDraftMap>(() => buildDocDrafts(car.documents));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const docsKey = CAR_DOCUMENT_TYPES.map((type) => {
    const doc = car.documents.find((item) => item.type === type);
    return `${type}:${doc?.expiresAt ?? ''}:${doc?.policyNumber ?? ''}:${doc?.notes ?? ''}`;
  }).join('|');

  useEffect(() => {
    setNextServiceMileage(car.nextServiceMileage !== null ? String(car.nextServiceMileage) : '');
    setNextServiceDate(car.nextServiceDate ?? '');
    setDocDrafts(buildDocDrafts(car.documents));
    // docsKey encodes primitive document field values to prevent resetting in-progress typing on identical rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car.id, car.nextServiceMileage, car.nextServiceDate, docsKey]);

  function updateDocField(type: CarDocumentType, field: keyof DocDraft, value: string) {
    setDocDrafts((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
      },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const existingTypes = new Set(car.documents.map((doc) => doc.type));
    const missingDateType = CAR_DOCUMENT_TYPES.find((type) => {
      const draft = docDrafts[type];
      return (
        !existingTypes.has(type) &&
        !draft.expiresAt.trim() &&
        (draft.policyNumber.trim() !== '' || draft.notes.trim() !== '')
      );
    });
    if (missingDateType) {
      setFeedback({
        kind: 'error',
        message: `Укажите дату окончания для документа «${CAR_DOCUMENT_LABELS[missingDateType]}»`,
      });
      return;
    }

    const trimmedMileage = nextServiceMileage.trim();
    const parsedMileage = trimmedMileage === '' ? null : Number(trimmedMileage);

    const documentsPayload = CAR_DOCUMENT_TYPES.flatMap((type) => {
      const draft = docDrafts[type];
      const expiresAt = draft.expiresAt.trim();
      if (!expiresAt) return [];
      return [
        {
          type,
          expiresAt,
          policyNumber: draft.policyNumber,
          notes: draft.notes,
        },
      ];
    });

    const parsed = upsertDocumentsSchema.safeParse({
      nextServiceMileage: parsedMileage,
      nextServiceDate,
      documents: documentsPayload,
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные документов и ТО',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/cars/${car.id}/documents`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось сохранить документы и сроки ТО'),
        });
        return;
      }

      const data = (await response.json()) as {
        documents?: CarDocumentDto[];
        deadlines?: CarDeadlineSummary;
        nextServiceMileage?: number | null;
        nextServiceDate?: string | null;
      };

      await onCarUpdated((prev) => ({
        ...prev,
        nextServiceMileage:
          data.nextServiceMileage !== undefined ? data.nextServiceMileage : prev.nextServiceMileage,
        nextServiceDate:
          data.nextServiceDate !== undefined ? data.nextServiceDate : prev.nextServiceDate,
        documents: data.documents ?? prev.documents,
        deadlines: data.deadlines ?? prev.deadlines,
        deadlineStatus: data.deadlines?.status ?? prev.deadlineStatus,
        urgentDeadlinesCount: data.deadlines?.urgentDeadlinesCount ?? prev.urgentDeadlinesCount,
      }));

      setFeedback({ kind: 'success', message: 'Документы и сроки ТО сохранены' });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'Не удалось сохранить документы. Проверьте сеть',
      });
    } finally {
      setSaving(false);
    }
  }

  const serviceMileageDeadline = car.deadlines.serviceMileage;
  const serviceDateDeadline = car.deadlines.serviceDate;
  const docDeadlinesByType = new Map(
    car.deadlines.documents.map((item) => [item.type, item]),
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Плановое ТО</h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Текущий пробег: <span className="tabular-nums">{formatMileage(car.mileage)}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="doc-service-mileage" className="text-xs font-medium text-[var(--text-secondary)]">
                Следующее ТО, км
              </label>
              {serviceMileageDeadline && (
                <span className="inline-flex items-center gap-1.5">
                  <DeadlineBadge status={serviceMileageDeadline.status} />
                  {serviceMileageDeadline.mileageLeft <= 0 ? (
                    <span className="text-[11px] text-[var(--text-secondary)]">пора пройти</span>
                  ) : serviceMileageDeadline.status === 'warning' ? (
                    <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                      осталось {formatMileage(serviceMileageDeadline.mileageLeft)}
                    </span>
                  ) : null}
                </span>
              )}
            </div>
            <input
              id="doc-service-mileage"
              name="nextServiceMileage"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={nextServiceMileage}
              onChange={(event) => setNextServiceMileage(event.target.value)}
              disabled={saving}
              placeholder="150000"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="doc-service-date" className="text-xs font-medium text-[var(--text-secondary)]">
                Следующее ТО, дата
              </label>
              {serviceDateDeadline && (
                <span className="inline-flex items-center gap-1.5">
                  <DeadlineBadge status={serviceDateDeadline.status} />
                  {(() => {
                    const hint = formatDateHint(serviceDateDeadline.daysLeft);
                    return hint ? (
                      <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                        {hint}
                      </span>
                    ) : null;
                  })()}
                </span>
              )}
            </div>
            <input
              id="doc-service-date"
              name="nextServiceDate"
              type="date"
              value={nextServiceDate}
              onChange={(event) => setNextServiceDate(event.target.value)}
              disabled={saving}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Документы автомобиля
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Оставьте дату окончания пустой, чтобы удалить документ этого типа.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CAR_DOCUMENT_TYPES.map((type) => {
            const draft = docDrafts[type];
            const deadline = docDeadlinesByType.get(type);
            const hint = deadline ? formatDateHint(deadline.daysLeft) : null;
            const willDeleteSavedDoc = deadline !== undefined && !draft.expiresAt.trim();

            return (
              <fieldset
                key={type}
                className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5"
              >
                <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
                  {CAR_DOCUMENT_LABELS[type]}
                </legend>

                {deadline && (
                  <div className="flex flex-wrap items-center gap-2">
                    <DeadlineBadge status={deadline.status} />
                    {hint && (
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {hint}
                      </span>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor={`doc-${type}-expires`} className={LABEL_CLASS}>
                    Дата окончания
                  </label>
                  <input
                    id={`doc-${type}-expires`}
                    name={`documents.${type}.expiresAt`}
                    type="date"
                    value={draft.expiresAt}
                    onChange={(event) => updateDocField(type, 'expiresAt', event.target.value)}
                    disabled={saving}
                    className={`${INPUT_CLASS} tabular-nums`}
                  />
                  {willDeleteSavedDoc && (
                    <p
                      style={{ color: 'var(--status-overdue-text)' }}
                      className="mt-1 text-[11px] font-medium"
                    >
                      Дата очищена — документ будет удалён при сохранении
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={`doc-${type}-policy`} className={LABEL_CLASS}>
                    Номер документа
                  </label>
                  <input
                    id={`doc-${type}-policy`}
                    name={`documents.${type}.policyNumber`}
                    type="text"
                    value={draft.policyNumber}
                    onChange={(event) => updateDocField(type, 'policyNumber', event.target.value)}
                    disabled={saving}
                    placeholder="Необязательно"
                    className={`${INPUT_CLASS} font-mono text-xs tabular-nums`}
                  />
                </div>

                <div>
                  <label htmlFor={`doc-${type}-notes`} className={LABEL_CLASS}>
                    Примечание
                  </label>
                  <input
                    id={`doc-${type}-notes`}
                    name={`documents.${type}.notes`}
                    type="text"
                    value={draft.notes}
                    onChange={(event) => updateDocField(type, 'notes', event.target.value)}
                    disabled={saving}
                    placeholder="Необязательно"
                    className={INPUT_CLASS}
                  />
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className={PRIMARY_BTN_CLASS}>
          {saving ? 'Сохранение...' : 'Сохранить документы и сроки'}
        </button>
      </div>
    </form>
  );
}
