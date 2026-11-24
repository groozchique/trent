'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import type { CarStatus, FineStatus, RentalPeriodicity } from '@/db/schema';
import { SHOW_FINES } from '@/lib/features';
import {
  formatDateRu,
  formatDateTimeRu,
  formatMileage,
  formatRentalPeriod,
  formatRub,
} from '@/lib/format';
import {
  createCarSchema,
  createDriverSchema,
  createFineSchema,
  createMaintenanceSchema,
  endRentalSchema,
  upsertRentalSchema,
  type CarDetailDto,
  type CarSummaryDto,
  type DriverDto,
  type FineDto,
  type MaintenanceDto,
  type OwnerOptionDto,
  type RentalDto,
  type RentalHistoryItemDto,
} from '@/lib/validation';
import { BrandIcon, KNOWN_BRANDS } from './BrandIcon';
import { CarDocumentsTab } from './CarDocumentsTab';
import { FineStatusPill } from './FinesListModal';
import { StatusBadge } from './StatusBadge';

type ManageTabId = 'info' | 'documents' | 'maintenance' | 'rental' | 'fines';

const MANAGE_TABS: Array<{ id: ManageTabId; label: string }> = [
  { id: 'info', label: 'Общая информация' },
  { id: 'documents', label: 'Документы и ТО' },
  { id: 'maintenance', label: 'ТО и ремонт' },
  { id: 'rental', label: 'Аренда' },
  { id: 'fines', label: 'Штрафы' },
];

const VISIBLE_MANAGE_TABS = SHOW_FINES
  ? MANAGE_TABS
  : MANAGE_TABS.filter((tab) => tab.id !== 'fines');

const CAR_STATUS_OPTIONS: Array<{ value: CarStatus; label: string }> = [
  { value: 'in_rent', label: 'В аренде' },
  { value: 'in_repair', label: 'На ремонте' },
  { value: 'available', label: 'Не в аренде' },
];

const PERIODICITY_OPTIONS: Array<{ value: RentalPeriodicity; label: string }> = [
  { value: 'daily', label: 'Ежедневно' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: 'monthly', label: 'Ежемесячно' },
];

const PERIODICITY_RATE_LABEL: Record<RentalPeriodicity, string> = {
  daily: 'в день',
  weekly: 'в неделю',
  monthly: 'в месяц',
};

const EMPTY_DRIVERS: DriverDto[] = [];
const EMPTY_OWNERS: OwnerOptionDto[] = [];

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

const PRIMARY_BTN_CLASS =
  'inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const SECONDARY_BTN_CLASS =
  'inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50';

type FeedbackState = { kind: 'error' | 'success'; message: string } | null;

type PartRowDraft = {
  key: number;
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
};

function parseRequiredNumber(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function toPreviewInt(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function summarizeFines(items: FineDto[]): { unpaidFinesCount: number; unpaidFinesSum: number } {
  let unpaidFinesCount = 0;
  let unpaidFinesSum = 0;
  for (const item of items) {
    if (item.status === 'unpaid') {
      unpaidFinesCount += 1;
      unpaidFinesSum += item.amount;
    }
  }
  return { unpaidFinesCount, unpaidFinesSum };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

function FeedbackBanner({ feedback }: { feedback: FeedbackState }) {
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

function GeneralInfoTab({
  car,
  onCarUpdated,
}: {
  car: CarDetailDto;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const router = useRouter();
  const [plate, setPlate] = useState(car.plate);
  const [stsNumber, setStsNumber] = useState(car.stsNumber ?? '');
  const [brand, setBrand] = useState(car.brand);
  const [model, setModel] = useState(car.model);
  const [status, setStatus] = useState<CarStatus>(car.status);
  const [mileage, setMileage] = useState(String(car.mileage));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setPlate(car.plate);
    setStsNumber(car.stsNumber ?? '');
    setBrand(car.brand);
    setModel(car.model);
    setStatus(car.status);
    setMileage(String(car.mileage));
  }, [car.id, car.plate, car.stsNumber, car.brand, car.model, car.status, car.mileage]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const parsed = createCarSchema.safeParse({
      plate,
      brand,
      model,
      status,
      mileage: parseRequiredNumber(mileage),
      stsNumber,
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные автомобиля',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/cars/${car.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось обновить автомобиль'),
        });
        return;
      }

      const data = (await response.json()) as { car?: CarSummaryDto };
      await onCarUpdated((prev) =>
        data.car
          ? { ...prev, ...data.car }
          : { ...prev, ...parsed.data, stsNumber: parsed.data.stsNumber ?? null },
      );
      setFeedback({ kind: 'success', message: 'Изменения сохранены' });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить изменения. Проверьте сеть' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/cars/${car.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setDeleteError(await readApiError(response, 'Не удалось удалить автомобиль'));
        setDeleting(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setDeleteError('Не удалось удалить машину. Проверьте сеть');
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} noValidate className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Основные данные
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="manage-car-plate" className={LABEL_CLASS}>
              Гос. номер
            </label>
            <input
              id="manage-car-plate"
              name="plate"
              type="text"
              value={plate}
              onChange={(event) => setPlate(event.target.value)}
              disabled={busy}
              placeholder="А123ВС 777"
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-sts" className={LABEL_CLASS}>
              Номер СТС
            </label>
            <input
              id="manage-car-sts"
              name="stsNumber"
              type="text"
              value={stsNumber}
              onChange={(event) => setStsNumber(event.target.value)}
              disabled={busy}
              placeholder="99 01 123456"
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-status" className={LABEL_CLASS}>
              Статус
            </label>
            <select
              id="manage-car-status"
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as CarStatus)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              {CAR_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="manage-car-mileage" className={LABEL_CLASS}>
              Пробег, км
            </label>
            <input
              id="manage-car-mileage"
              name="mileage"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-brand" className={LABEL_CLASS}>
              Марка
            </label>
            <input
              id="manage-car-brand"
              name="brand"
              type="text"
              list="manage-car-brand-options"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              disabled={busy}
              placeholder="Kia"
              className={INPUT_CLASS}
            />
            <datalist id="manage-car-brand-options">
              {KNOWN_BRANDS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="manage-car-model" className={LABEL_CLASS}>
              Модель
            </label>
            <input
              id="manage-car-model"
              name="model"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={busy}
              placeholder="Rio"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <FeedbackBanner feedback={feedback} />

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={PRIMARY_BTN_CLASS}>
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>

      <section
        aria-label="Удаление машины"
        className="space-y-3 border-t border-[var(--border-subtle)] pt-5"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Удаление машины
          </h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {SHOW_FINES
              ? 'Машина и все записи по аренде, штрафам и ТО удалятся навсегда.'
              : 'Машина и все записи по аренде и ТО удалятся навсегда.'}
          </p>
        </div>

        {!confirmDelete ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            style={{
              backgroundColor: 'var(--status-repair-bg)',
              borderColor: 'var(--status-repair-border)',
              color: 'var(--status-repair-text)',
            }}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Удалить машину</span>
          </button>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--status-repair-bg)',
              borderColor: 'var(--status-repair-border)',
            }}
            className="space-y-3 rounded-xl border p-3.5"
          >
            <p
              style={{ color: 'var(--status-repair-text)' }}
              className="text-xs font-medium sm:text-sm"
            >
              Удалить {car.plate}? Отменить это нельзя.
            </p>
            <FeedbackBanner
              feedback={deleteError ? { kind: 'error', message: deleteError } : null}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete(false);
                }}
                className={SECONDARY_BTN_CLASS}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  void handleDelete();
                }}
                style={{
                  backgroundColor: 'var(--status-danger)',
                  color: 'var(--status-danger-fg)',
                }}
                className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MaintenanceTab({
  car,
  onCarUpdated,
}: {
  car: CarDetailDto;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const nextPartKey = useRef(1);
  const prevCarIdRef = useRef(car.id);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [performedAt, setPerformedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [mileage, setMileage] = useState(() => String(car.mileage));
  const [parts, setParts] = useState<PartRowDraft[]>([]);
  const [laborCost, setLaborCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  function resetToCreate(nextMileage: number) {
    setEditingRecordId(null);
    setTitle('');
    setPerformedAt(new Date().toISOString().slice(0, 10));
    setMileage(String(nextMileage));
    setParts([]);
    setLaborCost('0');
    setNotes('');
  }

  useEffect(() => {
    if (prevCarIdRef.current !== car.id) {
      prevCarIdRef.current = car.id;
      resetToCreate(car.mileage);
      setFeedback(null);
      return;
    }
    if (editingRecordId === null) {
      setMileage(String(car.mileage));
    }
  }, [car.id, car.mileage, editingRecordId]);

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

  function startEditRecord(record: MaintenanceDto) {
    setFeedback(null);
    setEditingRecordId(record.id);
    setTitle(record.title);
    setPerformedAt(record.performedAt);
    setMileage(String(record.mileage));
    setLaborCost(String(record.laborCost));
    setNotes(record.notes ?? '');
    setParts(
      record.parts.map((part) => ({
        key: nextPartKey.current++,
        name: part.name,
        sku: part.sku ?? '',
        quantity: String(part.quantity),
        unitPrice: String(part.unitPrice),
      })),
    );
  }

  function cancelEdit() {
    setFeedback(null);
    resetToCreate(car.mileage);
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

    const targetRecordId = editingRecordId;
    const isEdit = targetRecordId !== null;
    setSubmitting(true);
    try {
      const response = await fetch(
        isEdit
          ? `/api/cars/${car.id}/maintenance/${targetRecordId}`
          : `/api/cars/${car.id}/maintenance`,
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
      const nextCarMileage = Math.max(car.mileage, parsed.data.mileage);
      await onCarUpdated((prev) => ({
        ...prev,
        mileage: Math.max(prev.mileage, parsed.data.mileage),
        maintenance: data.record
          ? isEdit
            ? prev.maintenance.map((item) =>
                item.id === targetRecordId ? data.record! : item,
              )
            : [data.record, ...prev.maintenance]
          : prev.maintenance,
      }));

      resetToCreate(nextCarMileage);
      setFeedback({
        kind: 'success',
        message: isEdit ? 'Запись ТО обновлена' : 'Запись ТО добавлена',
      });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить запись ТО. Проверьте сеть' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {editingRecordId !== null ? 'Редактирование записи ТО' : 'Новое ТО или ремонт'}
        </h2>

        <div>
          <label htmlFor="maint-title" className={LABEL_CLASS}>
            Название работ
          </label>
          <input
            id="maint-title"
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
            <label htmlFor="maint-date" className={LABEL_CLASS}>
              Дата
            </label>
            <input
              id="maint-date"
              name="performedAt"
              type="date"
              value={performedAt}
              onChange={(event) => setPerformedAt(event.target.value)}
              disabled={submitting}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="maint-mileage" className={LABEL_CLASS}>
              Пробег, км
            </label>
            <input
              id="maint-mileage"
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
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
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
                    <label htmlFor={`part-name-${row.key}`} className={LABEL_CLASS}>
                      Запчасть
                    </label>
                    <input
                      id={`part-name-${row.key}`}
                      type="text"
                      value={row.name}
                      onChange={(event) => updatePartRow(row.key, 'name', event.target.value)}
                      disabled={submitting}
                      placeholder="Фильтр масляный"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor={`part-sku-${row.key}`} className={LABEL_CLASS}>
                      Артикул
                    </label>
                    <input
                      id={`part-sku-${row.key}`}
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
                      <label htmlFor={`part-qty-${row.key}`} className={LABEL_CLASS}>
                        Кол-во
                      </label>
                      <input
                        id={`part-qty-${row.key}`}
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
                      <label htmlFor={`part-price-${row.key}`} className={LABEL_CLASS}>
                        Цена, ₽
                      </label>
                      <input
                        id={`part-price-${row.key}`}
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
            <label htmlFor="maint-labor" className={LABEL_CLASS}>
              Стоимость работ, ₽
            </label>
            <input
              id="maint-labor"
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
            <label htmlFor="maint-notes" className={LABEL_CLASS}>
              Примечание
            </label>
            <input
              id="maint-notes"
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
          {editingRecordId !== null && (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={submitting}
              className={SECONDARY_BTN_CLASS}
            >
              Отменить правку
            </button>
          )}
          <button type="submit" disabled={submitting} className={PRIMARY_BTN_CLASS}>
            {submitting
              ? 'Сохранение...'
              : editingRecordId !== null
                ? 'Сохранить изменения'
                : 'Сохранить запись ТО'}
          </button>
        </div>
      </form>

      <section
        aria-label="Последние записи ТО"
        className="space-y-2.5 border-t border-[var(--border-subtle)] pt-5"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Записи ТО и ремонта ({car.maintenance.length})
        </h3>
        {car.maintenance.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
            Записей пока нет
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {car.maintenance.map((record) => (
              <li
                key={record.id}
                className="flex flex-col gap-2 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
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
                  <button
                    type="button"
                    onClick={() => startEditRecord(record)}
                    disabled={submitting}
                    className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Редактировать
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RentalTab({
  car,
  drivers,
  owners,
  onDriverCreated,
  onCarUpdated,
}: {
  car: CarDetailDto;
  drivers: DriverDto[];
  owners: OwnerOptionDto[];
  onDriverCreated: (driver: DriverDto) => void;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const [selectedOwnerId, setSelectedOwnerId] = useState(() =>
    car.ownerId !== null ? String(car.ownerId) : '',
  );
  const [savingOwner, setSavingOwner] = useState(false);
  const [ownerFeedback, setOwnerFeedback] = useState<FeedbackState>(null);

  const [driverId, setDriverId] = useState(() =>
    car.rental?.driverId !== null && car.rental?.driverId !== undefined
      ? String(car.rental.driverId)
      : '',
  );
  const [rateAmount, setRateAmount] = useState(
    car.rental ? String(car.rental.rateAmount) : '',
  );
  const [periodicity, setPeriodicity] = useState<RentalPeriodicity>(
    car.rental?.periodicity ?? 'daily',
  );
  const [startDate, setStartDate] = useState(
    () => car.rental?.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const [managerCommissionPercent, setManagerCommissionPercent] = useState(
    car.rental ? String(car.rental.managerCommissionPercent ?? 0) : '0',
  );
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [showNewDriver, setShowNewDriver] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [newDriverError, setNewDriverError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [endFeedback, setEndFeedback] = useState<FeedbackState>(null);

  const rentalId = car.rental?.id;
  const rentalDriverId = car.rental?.driverId ?? null;
  const rentalRateAmount = car.rental?.rateAmount;
  const rentalPeriodicity = car.rental?.periodicity;
  const rentalStartDate = car.rental?.startDate;
  const rentalManagerCommissionPercent = car.rental?.managerCommissionPercent;

  useEffect(() => {
    setSelectedOwnerId(car.ownerId !== null ? String(car.ownerId) : '');
  }, [car.id, car.ownerId]);

  useEffect(() => {
    setDriverId(rentalDriverId !== null ? String(rentalDriverId) : '');
    setRateAmount(rentalRateAmount !== undefined ? String(rentalRateAmount) : '');
    setPeriodicity(rentalPeriodicity ?? 'daily');
    setStartDate(rentalStartDate ?? new Date().toISOString().slice(0, 10));
    setManagerCommissionPercent(
      rentalManagerCommissionPercent !== undefined
        ? String(rentalManagerCommissionPercent)
        : '0',
    );
    setEndDate(new Date().toISOString().slice(0, 10));
  }, [
    car.id,
    rentalId,
    rentalDriverId,
    rentalRateAmount,
    rentalPeriodicity,
    rentalStartDate,
    rentalManagerCommissionPercent,
  ]);

  const ownerOptions = useMemo(() => {
    const options = owners.map((owner) => ({ id: owner.id, label: owner.label }));
    if (car.ownerId !== null && !options.some((option) => option.id === car.ownerId)) {
      options.unshift({
        id: car.ownerId,
        label: car.ownerName ?? `Собственник #${car.ownerId}`,
      });
    }
    return options;
  }, [owners, car.ownerId, car.ownerName]);

  const driverOptions = useMemo(() => {
    const activeOptions: Array<{ id: number; label: string }> = drivers
      .filter((driver) => !driver.archived)
      .map((driver) => ({ id: driver.id, label: driver.fullName }));

    if (
      rentalDriverId !== null &&
      !activeOptions.some((option) => option.id === rentalDriverId)
    ) {
      const archivedDriver = drivers.find((driver) => driver.id === rentalDriverId);
      activeOptions.unshift({
        id: rentalDriverId,
        label: archivedDriver
          ? `${archivedDriver.fullName} (в архиве)`
          : car.rental?.renterName ?? `Водитель #${rentalDriverId}`,
      });
    }

    return activeOptions;
  }, [drivers, rentalDriverId, car.rental?.renterName]);

  async function handleCreateDriver() {
    setNewDriverError(null);
    const parsed = createDriverSchema.safeParse({
      fullName: newDriverName,
      phone: newDriverPhone,
      notes: null,
    });

    if (!parsed.success) {
      setNewDriverError(parsed.error.issues[0]?.message ?? 'Некорректные данные водителя');
      return;
    }

    setCreatingDriver(true);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setNewDriverError(await readApiError(response, 'Не удалось создать водителя'));
        return;
      }

      const data = (await response.json()) as { driver?: DriverDto };
      if (!data.driver) {
        setNewDriverError('Ответ сервера не содержит данные водителя');
        return;
      }

      onDriverCreated(data.driver);
      setDriverId(String(data.driver.id));
      setNewDriverName('');
      setNewDriverPhone('');
      setShowNewDriver(false);
    } catch {
      setNewDriverError('Не удалось создать водителя. Проверьте сеть');
    } finally {
      setCreatingDriver(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const parsed = upsertRentalSchema.safeParse({
      driverId: parseOptionalNumber(driverId),
      rateAmount: parseRequiredNumber(rateAmount),
      periodicity,
      startDate,
      active: true,
      managerCommissionPercent: parseRequiredNumber(managerCommissionPercent.replace(',', '.')),
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные аренды',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/cars/${car.id}/rental`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось сохранить настройки аренды'),
        });
        return;
      }

      const data = (await response.json()) as { rental?: RentalDto; carStatus?: CarStatus };
      await onCarUpdated((prev) => ({
        ...prev,
        status: data.carStatus ?? prev.status,
        rental: data.rental ?? prev.rental,
        activeDriverId: data.rental ? data.rental.driverId : prev.activeDriverId,
        activeDriverName: data.rental ? data.rental.renterName : prev.activeDriverName,
      }));
      setFeedback({ kind: 'success', message: 'Настройки аренды сохранены' });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить аренду. Проверьте сеть' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEndRental() {
    if (!car.rental) return;
    setEndFeedback(null);

    const parsed = endRentalSchema.safeParse({ endDate });
    if (!parsed.success) {
      setEndFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректная дата окончания аренды',
      });
      return;
    }

    if (parsed.data.endDate && parsed.data.endDate < car.rental.startDate) {
      setEndFeedback({
        kind: 'error',
        message: 'Дата окончания не может быть раньше даты начала аренды',
      });
      return;
    }

    setEnding(true);
    try {
      const response = await fetch(`/api/cars/${car.id}/rental/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate: parsed.data.endDate }),
      });

      if (!response.ok) {
        setEndFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось завершить аренду'),
        });
        return;
      }

      const data = (await response.json()) as { rental?: RentalDto; carStatus?: CarStatus };
      await onCarUpdated((prev) => {
        const closedItem: RentalHistoryItemDto | null = data.rental
          ? { ...data.rental, rentDebt30d: 0 }
          : null;
        const nextHistory = closedItem
          ? [closedItem, ...prev.rentalHistory.filter((item) => item.id !== closedItem.id)]
          : prev.rentalHistory;

        return {
          ...prev,
          status: data.carStatus ?? (prev.status === 'in_rent' ? 'available' : prev.status),
          rental: null,
          activeDriverId: null,
          activeDriverName: null,
          rentalHistory: nextHistory,
        };
      });
      setFeedback({ kind: 'success', message: 'Аренда завершена' });
    } catch {
      setEndFeedback({ kind: 'error', message: 'Не удалось завершить аренду. Проверьте сеть' });
    } finally {
      setEnding(false);
    }
  }

  async function handleSaveOwner() {
    setOwnerFeedback(null);
    const nextOwnerId = parseOptionalNumber(selectedOwnerId);

    setSavingOwner(true);
    try {
      const response = await fetch(`/api/cars/${car.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: nextOwnerId }),
      });

      if (!response.ok) {
        setOwnerFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось сохранить собственника'),
        });
        return;
      }

      const data = (await response.json()) as { car?: CarSummaryDto };
      const resolvedName =
        nextOwnerId === null
          ? null
          : ownerOptions.find((option) => option.id === nextOwnerId)?.label ?? null;

      await onCarUpdated((prev) => ({
        ...prev,
        ownerId: data.car ? data.car.ownerId : nextOwnerId,
        ownerName: data.car ? data.car.ownerName : resolvedName,
      }));
      setOwnerFeedback({ kind: 'success', message: 'Собственник сохранён' });
    } catch {
      setOwnerFeedback({
        kind: 'error',
        message: 'Не удалось сохранить собственника. Проверьте сеть',
      });
    } finally {
      setSavingOwner(false);
    }
  }

  const busy = submitting || ending || creatingDriver || savingOwner;
  const pastRentals = car.rentalHistory.filter((item) => !item.active);

  return (
    <div className="space-y-6">
      <section
        aria-label="Собственник"
        className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Собственник
        </h2>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="rental-owner" className={LABEL_CLASS}>
              Собственник автомобиля
            </label>
            <select
              id="rental-owner"
              name="ownerId"
              value={selectedOwnerId}
              onChange={(event) => setSelectedOwnerId(event.target.value)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              <option value="">Не указан</option>
              {ownerOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void handleSaveOwner();
            }}
            className={`${PRIMARY_BTN_CLASS} shrink-0`}
          >
            {savingOwner ? 'Сохранение...' : 'Сохранить собственника'}
          </button>
        </div>

        <FeedbackBanner feedback={ownerFeedback} />
      </section>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Условия аренды
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="rental-driver" className={LABEL_CLASS}>
                  Водитель
                </label>
                <select
                  id="rental-driver"
                  name="driverId"
                  value={driverId}
                  onChange={(event) => setDriverId(event.target.value)}
                  disabled={busy}
                  className={INPUT_CLASS}
                >
                  <option value="">Выберите водителя</option>
                  {driverOptions.map((option) => (
                    <option key={option.id} value={String(option.id)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNewDriverError(null);
                  setShowNewDriver((prev) => !prev);
                }}
                className={`${SECONDARY_BTN_CLASS} w-full shrink-0 sm:w-auto`}
              >
                <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Новый водитель</span>
              </button>
            </div>

            {showNewDriver && (
              <div
                role="region"
                aria-label="Новый водитель"
                className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Добавить нового водителя
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="new-driver-name" className={LABEL_CLASS}>
                      ФИО
                    </label>
                    <input
                      id="new-driver-name"
                      type="text"
                      value={newDriverName}
                      onChange={(event) => setNewDriverName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleCreateDriver();
                        }
                      }}
                      disabled={creatingDriver}
                      placeholder="Сидоров Максим Олегович"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor="new-driver-phone" className={LABEL_CLASS}>
                      Телефон
                    </label>
                    <input
                      id="new-driver-phone"
                      type="tel"
                      value={newDriverPhone}
                      onChange={(event) => setNewDriverPhone(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleCreateDriver();
                        }
                      }}
                      disabled={creatingDriver}
                      placeholder="+7 903 555-66-77"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                <FeedbackBanner
                  feedback={newDriverError ? { kind: 'error', message: newDriverError } : null}
                />

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    disabled={creatingDriver}
                    onClick={() => {
                      setNewDriverError(null);
                      setShowNewDriver(false);
                    }}
                    className={SECONDARY_BTN_CLASS}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={creatingDriver}
                    onClick={() => {
                      void handleCreateDriver();
                    }}
                    className={PRIMARY_BTN_CLASS}
                  >
                    {creatingDriver ? 'Сохранение...' : 'Сохранить водителя'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="rental-rate" className={LABEL_CLASS}>
              Стоимость аренды, ₽
            </label>
            <input
              id="rental-rate"
              name="rateAmount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={rateAmount}
              onChange={(event) => setRateAmount(event.target.value)}
              disabled={busy}
              placeholder="2400"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="rental-periodicity" className={LABEL_CLASS}>
              Периодичность оплаты
            </label>
            <select
              id="rental-periodicity"
              name="periodicity"
              value={periodicity}
              onChange={(event) => setPeriodicity(event.target.value as RentalPeriodicity)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              {PERIODICITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rental-start-date" className={LABEL_CLASS}>
              С какого числа платится
            </label>
            <input
              id="rental-start-date"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="rental-manager-commission" className={LABEL_CLASS}>
              Процент менеджера, %
            </label>
            <input
              id="rental-manager-commission"
              name="managerCommissionPercent"
              type="number"
              min={0}
              max={100}
              step="0.5"
              inputMode="decimal"
              value={managerCommissionPercent}
              onChange={(event) => setManagerCommissionPercent(event.target.value)}
              disabled={busy}
              placeholder="0"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>
        </div>

        <FeedbackBanner feedback={feedback} />

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={PRIMARY_BTN_CLASS}>
            {submitting ? 'Сохранение...' : 'Сохранить аренду'}
          </button>
        </div>
      </form>

      {car.rental && car.rental.active && (
        <section
          aria-label="Завершение аренды"
          className="space-y-3 border-t border-[var(--border-subtle)] pt-5"
        >
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Завершить текущую аренду
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Текущий водитель: {car.rental.renterName} (с{' '}
              <span className="tabular-nums">{formatDateRu(car.rental.startDate)}</span>).
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-xs">
              <label htmlFor="rental-end-date" className={LABEL_CLASS}>
                Дата окончания
              </label>
              <input
                id="rental-end-date"
                name="endDate"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={busy}
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void handleEndRental();
              }}
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {ending ? 'Завершение...' : 'Завершить аренду'}
            </button>
          </div>

          <FeedbackBanner feedback={endFeedback} />
        </section>
      )}

      <section
        aria-label="История аренд"
        className="space-y-2.5 border-t border-[var(--border-subtle)] pt-5"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          История аренд ({pastRentals.length})
        </h3>
        {pastRentals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
            Прошлых аренд нет
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {pastRentals.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1.5 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--text-primary)]">
                    {item.renterName}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                    <span>{formatRentalPeriod(item.startDate, item.endDate)}</span>
                    {item.driverPhone && <span>{item.driverPhone}</span>}
                    {item.managerCommissionPercent > 0 && (
                      <span>Менеджер: {item.managerCommissionPercent}%</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
                  <span className="text-xs font-medium text-[var(--text-primary)] tabular-nums sm:text-sm">
                    {formatRub(item.rateAmount)} {PERIODICITY_RATE_LABEL[item.periodicity]}
                  </span>
                  {item.rentDebt30d > 0 && (
                    <span
                      style={{
                        backgroundColor: 'var(--status-overdue-bg)',
                        borderColor: 'var(--status-overdue-border)',
                        color: 'var(--status-overdue-text)',
                      }}
                      className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
                    >
                      Долг: {formatRub(item.rentDebt30d)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FinesTab({
  car,
  drivers,
  onCarUpdated,
}: {
  car: CarDetailDto;
  drivers: DriverDto[];
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const [driverId, setDriverId] = useState('');
  const [resolutionNumber, setResolutionNumber] = useState('');
  const [violatedAt, setViolatedAt] = useState(
    () => `${new Date().toISOString().slice(0, 10)}T12:00`,
  );
  const [amount, setAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountDeadline, setDiscountDeadline] = useState('');
  const [paymentDeadline, setPaymentDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<FineStatus>('unpaid');

  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [togglingFineId, setTogglingFineId] = useState<number | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<FeedbackState>(null);
  const [formFeedback, setFormFeedback] = useState<FeedbackState>(null);
  const [listFeedback, setListFeedback] = useState<FeedbackState>(null);

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => !driver.archived),
    [drivers],
  );

  async function handleSync() {
    setSyncFeedback(null);
    setSyncing(true);
    try {
      const response = await fetch(`/api/cars/${car.id}/fines/sync`, { method: 'POST' });
      if (!response.ok) {
        setSyncFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось синхронизировать штрафы'),
        });
        return;
      }

      const result = (await response.json()) as { inserted: number; updated: number };
      await onCarUpdated();
      setSyncFeedback({
        kind: 'success',
        message: `Синхронизация завершена: добавлено ${result.inserted}, обновлено ${result.updated}`,
      });
    } catch {
      setSyncFeedback({
        kind: 'error',
        message: 'Не удалось синхронизировать штрафы. Проверьте сеть',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateFine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormFeedback(null);

    const parsedDriverId = driverId === '' ? undefined : Number(driverId);

    const parsed = createFineSchema.safeParse({
      ...(parsedDriverId !== undefined ? { driverId: parsedDriverId } : {}),
      resolutionNumber,
      violatedAt,
      amount: parseRequiredNumber(amount),
      discountAmount: parseOptionalNumber(discountAmount),
      discountDeadline,
      paymentDeadline,
      description,
      status,
    });

    if (!parsed.success) {
      setFormFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные штрафа',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/cars/${car.id}/fines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFormFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось добавить штраф'),
        });
        return;
      }

      const data = (await response.json()) as { fine?: FineDto };
      await onCarUpdated((prev) => {
        const nextFines = data.fine ? [data.fine, ...prev.fines] : prev.fines;
        return {
          ...prev,
          fines: nextFines,
          ...summarizeFines(nextFines),
        };
      });

      setDriverId('');
      setResolutionNumber('');
      setAmount('');
      setDiscountAmount('');
      setDiscountDeadline('');
      setPaymentDeadline('');
      setDescription('');
      setStatus('unpaid');
      setFormFeedback({ kind: 'success', message: 'Штраф добавлен' });
    } catch {
      setFormFeedback({ kind: 'error', message: 'Не удалось добавить штраф. Проверьте сеть' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleFineStatus(fine: FineDto) {
    setListFeedback(null);
    const nextStatus: FineStatus = fine.status === 'paid' ? 'unpaid' : 'paid';
    setTogglingFineId(fine.id);

    try {
      const response = await fetch(`/api/cars/${car.id}/fines/${fine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        setListFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось обновить статус штрафа'),
        });
        return;
      }

      const data = (await response.json().catch(() => null)) as { fine?: FineDto } | null;
      const updatedFine = data?.fine ?? { ...fine, status: nextStatus };

      await onCarUpdated((prev) => {
        const nextFines = prev.fines.map((item) =>
          item.id === fine.id ? updatedFine : item,
        );
        return {
          ...prev,
          fines: nextFines,
          ...summarizeFines(nextFines),
        };
      });
    } catch {
      setListFeedback({
        kind: 'error',
        message: 'Не удалось обновить статус штрафа. Проверьте сеть',
      });
    } finally {
      setTogglingFineId(null);
    }
  }

  const busy = syncing || submitting || togglingFineId !== null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Синхронизация штрафов
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Проверить новые штрафы по номеру {car.plate} (
              {car.stsNumber ? `СТС ${car.stsNumber}` : 'СТС не указан'}).
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void handleSync();
            }}
            className={`${SECONDARY_BTN_CLASS} w-full shrink-0 sm:w-auto`}
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{syncing ? 'Синхронизация...' : 'Синхронизировать с API'}</span>
          </button>
        </div>

        <FeedbackBanner feedback={syncFeedback} />
      </div>

      <form
        aria-label="Добавить штраф вручную"
        onSubmit={handleCreateFine}
        noValidate
        className="space-y-4 border-t border-[var(--border-subtle)] pt-5"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Добавить штраф вручную
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fine-resolution" className={LABEL_CLASS}>
              Номер постановления
            </label>
            <input
              id="fine-resolution"
              name="resolutionNumber"
              type="text"
              value={resolutionNumber}
              onChange={(event) => setResolutionNumber(event.target.value)}
              disabled={busy}
              placeholder="18810177261100001001"
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="fine-violated-at" className={LABEL_CLASS}>
              Дата и время нарушения
            </label>
            <input
              id="fine-violated-at"
              name="violatedAt"
              type="datetime-local"
              value={violatedAt}
              onChange={(event) => setViolatedAt(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="fine-amount" className={LABEL_CLASS}>
              Сумма штрафа, ₽
            </label>
            <input
              id="fine-amount"
              name="amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={busy}
              placeholder="1500"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="fine-discount-amount" className={LABEL_CLASS}>
              Сумма со скидкой, ₽
            </label>
            <input
              id="fine-discount-amount"
              name="discountAmount"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={discountAmount}
              onChange={(event) => setDiscountAmount(event.target.value)}
              disabled={busy}
              placeholder="Необязательно"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="fine-discount-deadline" className={LABEL_CLASS}>
              Срок действия скидки
            </label>
            <input
              id="fine-discount-deadline"
              name="discountDeadline"
              type="date"
              value={discountDeadline}
              onChange={(event) => setDiscountDeadline(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="fine-payment-deadline" className={LABEL_CLASS}>
              Крайний срок оплаты
            </label>
            <input
              id="fine-payment-deadline"
              name="paymentDeadline"
              type="date"
              value={paymentDeadline}
              onChange={(event) => setPaymentDeadline(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="fine-description" className={LABEL_CLASS}>
              Описание нарушения
            </label>
            <input
              id="fine-description"
              name="description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
              placeholder="Превышение скорости на 20–40 км/ч"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="fine-driver" className={LABEL_CLASS}>
              Водитель
            </label>
            <select
              id="fine-driver"
              name="driverId"
              value={driverId}
              onChange={(event) => setDriverId(event.target.value)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              <option value="">Автоматически по дате нарушения</option>
              {activeDrivers.map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="fine-status" className={LABEL_CLASS}>
              Статус штрафа
            </label>
            <select
              id="fine-status"
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as FineStatus)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              <option value="unpaid">Не оплачен</option>
              <option value="paid">Оплачен</option>
            </select>
          </div>
        </div>

        <FeedbackBanner feedback={formFeedback} />

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={PRIMARY_BTN_CLASS}>
            {submitting ? 'Сохранение...' : 'Добавить штраф'}
          </button>
        </div>
      </form>

      <section
        aria-label="Список штрафов автомобиля"
        className="space-y-2.5 border-t border-[var(--border-subtle)] pt-5"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Текущие штрафы ({car.fines.length})
        </h3>
        <FeedbackBanner feedback={listFeedback} />
        {car.fines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-xs text-[var(--text-secondary)]">
            Штрафов нет
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {car.fines.map((fine) => {
              const isToggling = togglingFineId === fine.id;
              return (
                <li
                  key={fine.id}
                  className="flex flex-col gap-2 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--text-primary)] sm:truncate">
                      {fine.description}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                      <span>{formatDateTimeRu(fine.violatedAt)}</span>
                      <span>Водитель: {fine.driverName ?? 'Не определён'}</span>
                      <span className="font-mono break-all">{fine.resolutionNumber}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap shrink-0 items-center justify-between gap-2 sm:justify-end">
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {formatRub(fine.amount)}
                    </span>
                    <FineStatusPill status={fine.status} />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void handleToggleFineStatus(fine);
                      }}
                      className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isToggling
                        ? 'Сохранение...'
                        : fine.status === 'paid'
                          ? 'Вернуть в неоплаченные'
                          : 'Отметить оплаченным'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Dedicated admin management page client with accessible 5-tab car controls. */
export function CarManageClient({
  car,
  drivers = EMPTY_DRIVERS,
  owners = EMPTY_OWNERS,
}: {
  car: CarDetailDto;
  drivers?: DriverDto[];
  owners?: OwnerOptionDto[];
}) {
  const router = useRouter();
  const [carState, setCarState] = useState<CarDetailDto>(car);
  const [driverList, setDriverList] = useState<DriverDto[]>(drivers);
  const [activeTab, setActiveTab] = useState<ManageTabId>('info');
  const tabRefs = useRef<Partial<Record<ManageTabId, HTMLButtonElement | null>>>({});

  const driversSignature = drivers
    .map((item) => `${item.id}:${item.fullName}:${item.phone ?? ''}:${item.archived}`)
    .join('|');

  useEffect(() => {
    setCarState(car);
  }, [car]);

  useEffect(() => {
    setDriverList(drivers);
    // Sync only when driver list content actually changes, preserving inline-added drivers across car-only rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driversSignature]);

  function handleDriverCreated(created: DriverDto) {
    setDriverList((prev) =>
      prev.some((item) => item.id === created.id) ? prev : [...prev, created],
    );
  }

  async function refreshCar(optimisticPatch?: (prev: CarDetailDto) => CarDetailDto) {
    if (optimisticPatch) {
      setCarState(optimisticPatch);
    }
    try {
      const response = await fetch(`/api/cars/${car.id}`, { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { car?: CarDetailDto };
        if (data.car) {
          setCarState(data.car);
        }
      }
    } catch {
      // Keep optimistic state responsive and rely on router.refresh() if refetch fails.
    } finally {
      router.refresh();
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % VISIBLE_MANAGE_TABS.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + VISIBLE_MANAGE_TABS.length) % VISIBLE_MANAGE_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = VISIBLE_MANAGE_TABS.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();
    const targetTab = VISIBLE_MANAGE_TABS[nextIndex];
    setActiveTab(targetTab.id);
    tabRefs.current[targetTab.id]?.focus();
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-6 sm:py-6">
      <div className="mb-3">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] sm:text-sm"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>На дашборд</span>
        </Link>
      </div>

      <header className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandIcon
              brand={carState.brand}
              className="h-6 w-6 shrink-0 text-[var(--text-secondary)]"
            />
            <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-[var(--text-primary)] sm:text-xl">
              {carState.brand} {carState.model}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 font-mono text-xs font-semibold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-sm">
              {carState.plate}
            </span>
            {carState.stsNumber && (
              <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                СТС: {carState.stsNumber}
              </span>
            )}
            <StatusBadge status={carState.status} />
            <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums sm:text-sm">
              {formatMileage(carState.mileage)}
            </span>
          </div>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Разделы управления автомобилем"
        className="mt-4 flex gap-1.5 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5"
      >
        {VISIBLE_MANAGE_TABS.map((tab, index) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`manage-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={isSelected ? `manage-panel-${tab.id}` : undefined}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={
                isSelected
                  ? 'inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-3.5 text-xs font-medium whitespace-nowrap text-[var(--accent-fg)] transition-colors sm:text-sm'
                  : 'inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg px-3.5 text-xs font-medium whitespace-nowrap text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] sm:text-sm'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`manage-panel-${activeTab}`}
        aria-labelledby={`manage-tab-${activeTab}`}
        className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:p-6"
      >
        {activeTab === 'info' && (
          <GeneralInfoTab car={carState} onCarUpdated={refreshCar} />
        )}
        {activeTab === 'documents' && (
          <CarDocumentsTab car={carState} onCarUpdated={refreshCar} />
        )}
        {activeTab === 'maintenance' && (
          <MaintenanceTab car={carState} onCarUpdated={refreshCar} />
        )}
        {activeTab === 'rental' && (
          <RentalTab
            car={carState}
            drivers={driverList}
            owners={owners}
            onDriverCreated={handleDriverCreated}
            onCarUpdated={refreshCar}
          />
        )}
        {SHOW_FINES && activeTab === 'fines' && (
          <FinesTab car={carState} drivers={driverList} onCarUpdated={refreshCar} />
        )}
      </section>
    </main>
  );
}
