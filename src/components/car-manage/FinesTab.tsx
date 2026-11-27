'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import type { FineStatus } from '@/db/schema';
import { readApiError } from '@/lib/api-client';
import { formatDateTimeRu, formatRub, getTodayIso } from '@/lib/format';
import {
  createFineSchema,
  type CarDetailDto,
  type DriverDto,
  type FineDto,
} from '@/lib/validation';
import { FeedbackBanner, type FeedbackState } from '../FeedbackBanner';
import { FineStatusPill } from '../FinesListModal';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BTN_CLASS,
  SECONDARY_BTN_CLASS,
  parseOptionalNumber,
  parseRequiredNumber,
  summarizeFines,
} from './shared';

/** Vehicle traffic fines sync, manual creation, and status toggle tab. */
export function FinesTab({
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
  const [violatedAt, setViolatedAt] = useState(() => `${getTodayIso()}T12:00`);
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
