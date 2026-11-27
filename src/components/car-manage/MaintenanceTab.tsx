'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { readApiError } from '@/lib/api-client';
import { formatDateRu, formatMileage, formatRub, getTodayIso } from '@/lib/format';
import {
  createMaintenanceSchema,
  type CarDetailDto,
  type MaintenanceDto,
} from '@/lib/validation';
import { FeedbackBanner, type FeedbackState } from '../FeedbackBanner';
import { ModalShell } from '../ModalShell';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BTN_CLASS,
  SECONDARY_BTN_CLASS,
  parseRequiredNumber,
  toPreviewInt,
} from './shared';

type PartRowDraft = {
  key: number;
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
};

function MaintenanceRecordForm({
  carId,
  carMileage,
  mode,
  initialRecord,
  idPrefix,
  onSaved,
  onCancel,
  onSubmittingChange,
}: {
  carId: number;
  carMileage: number;
  mode: 'create' | 'edit';
  initialRecord?: MaintenanceDto;
  idPrefix: string;
  onSaved: (record: MaintenanceDto | undefined, submittedMileage: number) => Promise<void>;
  onCancel?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const isEdit = mode === 'edit' && initialRecord !== undefined;
  const nextPartKey = useRef((initialRecord?.parts.length ?? 0) + 1);
  const prevCarIdRef = useRef(carId);
  const [title, setTitle] = useState(() => initialRecord?.title ?? '');
  const [performedAt, setPerformedAt] = useState(
    () => initialRecord?.performedAt ?? getTodayIso(),
  );
  const [mileage, setMileage] = useState(() =>
    String(initialRecord ? initialRecord.mileage : carMileage),
  );
  const [parts, setParts] = useState<PartRowDraft[]>(() =>
    initialRecord
      ? initialRecord.parts.map((part, index) => ({
          key: index + 1,
          name: part.name,
          sku: part.sku ?? '',
          quantity: String(part.quantity),
          unitPrice: String(part.unitPrice),
        }))
      : [],
  );
  const [laborCost, setLaborCost] = useState(() =>
    initialRecord ? String(initialRecord.laborCost) : '0',
  );
  const [notes, setNotes] = useState(() => initialRecord?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  function resetCreateForm(nextMileage: number) {
    setTitle('');
    setPerformedAt(getTodayIso());
    setMileage(String(nextMileage));
    setParts([]);
    setLaborCost('0');
    setNotes('');
  }

  useEffect(() => {
    if (mode !== 'create') return;
    if (prevCarIdRef.current !== carId) {
      prevCarIdRef.current = carId;
      resetCreateForm(carMileage);
      setFeedback(null);
      return;
    }
    setMileage(String(carMileage));
  }, [carId, carMileage, mode]);

  useEffect(() => {
    onSubmittingChange?.(submitting);
  }, [onSubmittingChange, submitting]);

  const partsSum = parts.reduce(
    (sum, part) => sum + toPreviewInt(part.quantity) * toPreviewInt(part.unitPrice),
    0,
  );
  const laborPreview = toPreviewInt(laborCost);
  const liveTotal = partsSum + laborPreview;

  function addPartRow() {
    const key = nextPartKey.current++;
    setParts((prev) => [...prev, { key, name: '', sku: '', quantity: '1', unitPrice: '' }]);
  }

  function updatePartRow(key: number, field: keyof Omit<PartRowDraft, 'key'>, value: string) {
    setParts((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  }

  function removePartRow(key: number) {
    setParts((prev) => prev.filter((row) => row.key !== key));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const parsed = createMaintenanceSchema.safeParse({
      title,
      performedAt,
      mileage: parseRequiredNumber(mileage),
      laborCost: parseRequiredNumber(laborCost),
      notes,
      parts: parts.map((part) => ({
        name: part.name,
        sku: part.sku,
        quantity: parseRequiredNumber(part.quantity),
        unitPrice: parseRequiredNumber(part.unitPrice),
      })),
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные записи ТО',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        isEdit
          ? `/api/cars/${carId}/maintenance/${initialRecord.id}`
          : `/api/cars/${carId}/maintenance`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(
            response,
            isEdit ? 'Не удалось обновить запись ТО' : 'Не удалось добавить запись ТО',
          ),
        });
        return;
      }

      const data = (await response.json()) as { record?: MaintenanceDto };
      await onSaved(data.record, parsed.data.mileage);

      if (!isEdit) {
        resetCreateForm(Math.max(carMileage, parsed.data.mileage));
        setFeedback({ kind: 'success', message: 'Запись ТО добавлена' });
      }
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить запись ТО. Проверьте сеть' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {mode === 'create' && (
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Новое ТО или ремонт
        </h2>
      )}

      <div>
        <label htmlFor={`${idPrefix}-title`} className={LABEL_CLASS}>
          Название работ
        </label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={submitting}
          placeholder="ТО-150: замена масла и фильтров"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-date`} className={LABEL_CLASS}>
            Дата
          </label>
          <input
            id={`${idPrefix}-date`}
            name="performedAt"
            type="date"
            value={performedAt}
            onChange={(event) => setPerformedAt(event.target.value)}
            disabled={submitting}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-mileage`} className={LABEL_CLASS}>
            Пробег, км
          </label>
          <input
            id={`${idPrefix}-mileage`}
            name="mileage"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
            disabled={submitting}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Запчасти и материалы
          </h3>
          <button
            type="button"
            onClick={addPartRow}
            disabled={submitting}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Добавить запчасть</span>
          </button>
        </div>

        {parts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
            Запчасти не добавлены. Можно сохранить только стоимость работ
          </p>
        ) : (
          <ul className="space-y-2.5">
            {parts.map((row, index) => (
              <li
                key={row.key}
                className="grid grid-cols-1 gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 sm:grid-cols-12 sm:items-end"
              >
                <div className="sm:col-span-4">
                  <label htmlFor={`${idPrefix}-part-name-${row.key}`} className={LABEL_CLASS}>
                    Запчасть
                  </label>
                  <input
                    id={`${idPrefix}-part-name-${row.key}`}
                    type="text"
                    value={row.name}
                    onChange={(event) => updatePartRow(row.key, 'name', event.target.value)}
                    disabled={submitting}
                    placeholder="Фильтр масляный"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor={`${idPrefix}-part-sku-${row.key}`} className={LABEL_CLASS}>
                    Артикул
                  </label>
                  <input
                    id={`${idPrefix}-part-sku-${row.key}`}
                    type="text"
                    value={row.sku}
                    onChange={(event) => updatePartRow(row.key, 'sku', event.target.value)}
                    disabled={submitting}
                    placeholder="Необязательно"
                    className={`${INPUT_CLASS} font-mono text-xs tabular-nums`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:col-span-4">
                  <div>
                    <label htmlFor={`${idPrefix}-part-qty-${row.key}`} className={LABEL_CLASS}>
                      Кол-во
                    </label>
                    <input
                      id={`${idPrefix}-part-qty-${row.key}`}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(event) => updatePartRow(row.key, 'quantity', event.target.value)}
                      disabled={submitting}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idPrefix}-part-price-${row.key}`} className={LABEL_CLASS}>
                      Цена, ₽
                    </label>
                    <input
                      id={`${idPrefix}-part-price-${row.key}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={row.unitPrice}
                      onChange={(event) => updatePartRow(row.key, 'unitPrice', event.target.value)}
                      disabled={submitting}
                      placeholder="0"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="flex justify-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => removePartRow(row.key)}
                    disabled={submitting}
                    aria-label={`Удалить запчасть ${index + 1}`}
                    className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-labor`} className={LABEL_CLASS}>
            Стоимость работ, ₽
          </label>
          <input
            id={`${idPrefix}-labor`}
            name="laborCost"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={laborCost}
            onChange={(event) => setLaborCost(event.target.value)}
            disabled={submitting}
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-notes`} className={LABEL_CLASS}>
            Примечание
          </label>
          <input
            id={`${idPrefix}-notes`}
            name="notes"
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            placeholder="Необязательно"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <dl className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-xs text-[var(--text-secondary)]">Запчасти</dt>
          <dd className="font-medium text-[var(--text-primary)] tabular-nums">
            {formatRub(partsSum)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-xs text-[var(--text-secondary)]">Работы</dt>
          <dd className="font-medium text-[var(--text-primary)] tabular-nums">
            {formatRub(laborPreview)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-2">
          <dt className="font-semibold text-[var(--text-primary)]">Итого</dt>
          <dd
            data-testid="maintenance-live-total"
            className="text-base font-semibold text-[var(--text-primary)] tabular-nums"
          >
            {formatRub(liveTotal)}
          </dd>
        </div>
      </dl>

      <FeedbackBanner feedback={feedback} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={SECONDARY_BTN_CLASS}
          >
            Отмена
          </button>
        )}
        <button type="submit" disabled={submitting} className={PRIMARY_BTN_CLASS}>
          {submitting
            ? 'Сохранение...'
            : isEdit
              ? 'Сохранить изменения'
              : 'Сохранить запись ТО'}
        </button>
      </div>
    </form>
  );
}

/** Maintenance records tab with creation form, history list, modal edit, and inline deletion. */
export function MaintenanceTab({
  car,
  onCarUpdated,
}: {
  car: CarDetailDto;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const prevCarIdRef = useRef(car.id);
  const [editingRecord, setEditingRecord] = useState<MaintenanceDto | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = useState<number | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listFeedback, setListFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    if (prevCarIdRef.current !== car.id) {
      prevCarIdRef.current = car.id;
      setEditingRecord(null);
      setConfirmDeleteRecordId(null);
      setDeleteError(null);
      setListFeedback(null);
    }
  }, [car.id]);

  async function handleDeleteRecord(record: MaintenanceDto) {
    setDeleteError(null);
    setListFeedback(null);
    setDeletingRecordId(record.id);
    try {
      const response = await fetch(`/api/cars/${car.id}/maintenance/${record.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        setDeleteError(await readApiError(response, 'Не удалось удалить запись ТО'));
        return;
      }

      if (editingRecord?.id === record.id) {
        setEditingRecord(null);
      }
      setConfirmDeleteRecordId(null);
      setDeleteError(null);

      await onCarUpdated((prev) => ({
        ...prev,
        maintenance: prev.maintenance.filter((item) => item.id !== record.id),
      }));

      setListFeedback({ kind: 'success', message: 'Запись ТО удалена' });
    } catch {
      setDeleteError('Не удалось удалить запись ТО. Проверьте сеть');
    } finally {
      setDeletingRecordId(null);
    }
  }

  return (
    <div className="space-y-6">
      <MaintenanceRecordForm
        carId={car.id}
        carMileage={car.mileage}
        mode="create"
        idPrefix="maint"
        onSaved={async (record, submittedMileage) => {
          setListFeedback(null);
          await onCarUpdated((prev) => ({
            ...prev,
            mileage: Math.max(prev.mileage, submittedMileage),
            maintenance: record ? [record, ...prev.maintenance] : prev.maintenance,
          }));
        }}
      />

      <section
        aria-label="Последние записи ТО"
        className="space-y-2.5 border-t border-[var(--border-subtle)] pt-5"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Записи ТО и ремонта ({car.maintenance.length})
        </h3>
        <FeedbackBanner feedback={listFeedback} />
        {car.maintenance.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
            Записей пока нет
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {car.maintenance.map((record) => {
              const isDeleteOpen = confirmDeleteRecordId === record.id;
              const isDeleting = deletingRecordId === record.id;
              const rowBusy = deletingRecordId !== null;
              return (
                <li key={record.id} className="flex flex-col gap-2 px-3.5 py-2.5 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--text-primary)]">{record.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                        <span>{formatDateRu(record.performedAt)}</span>
                        <span>{formatMileage(record.mileage)}</span>
                        {record.parts.length > 0 && <span>Запчастей: {record.parts.length}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                        {formatRub(record.totalCost)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteRecordId(null);
                            setDeleteError(null);
                            setListFeedback(null);
                            setEditingRecord(record);
                          }}
                          disabled={rowBusy}
                          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteRecordId(isDeleteOpen ? null : record.id);
                          }}
                          disabled={rowBusy}
                          style={{
                            backgroundColor: 'var(--status-repair-bg)',
                            borderColor: 'var(--status-repair-border)',
                            color: 'var(--status-repair-text)',
                          }}
                          className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>Удалить</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {isDeleteOpen && (
                    <div
                      style={{
                        backgroundColor: 'var(--status-repair-bg)',
                        borderColor: 'var(--status-repair-border)',
                      }}
                      className="space-y-2.5 rounded-lg border p-3"
                    >
                      <p
                        style={{ color: 'var(--status-repair-text)' }}
                        className="text-xs font-medium"
                      >
                        Удалить запись «{record.title}»? Отменить это нельзя.
                      </p>
                      <FeedbackBanner
                        feedback={deleteError ? { kind: 'error', message: deleteError } : null}
                      />
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteRecordId(null);
                          }}
                          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => {
                            void handleDeleteRecord(record);
                          }}
                          style={{
                            backgroundColor: 'var(--status-danger)',
                            color: 'var(--status-danger-fg)',
                          }}
                          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg px-3 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeleting ? 'Удаление...' : 'Да, удалить'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editingRecord && (
        <ModalShell
          title="Редактирование записи ТО"
          maxWidthClass="max-w-2xl"
          closeDisabled={editSubmitting}
          onClose={() => setEditingRecord(null)}
        >
          <MaintenanceRecordForm
            key={editingRecord.id}
            carId={car.id}
            carMileage={car.mileage}
            mode="edit"
            initialRecord={editingRecord}
            idPrefix="edit-maint"
            onSubmittingChange={setEditSubmitting}
            onCancel={() => setEditingRecord(null)}
            onSaved={async (record, submittedMileage) => {
              const targetId = editingRecord.id;
              await onCarUpdated((prev) => ({
                ...prev,
                mileage: Math.max(prev.mileage, submittedMileage),
                maintenance: record
                  ? prev.maintenance.map((item) => (item.id === targetId ? record : item))
                  : prev.maintenance,
              }));
              setEditingRecord(null);
              setListFeedback({ kind: 'success', message: 'Запись ТО обновлена' });
            }}
          />
        </ModalShell>
      )}
    </div>
  );
}
