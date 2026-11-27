'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { CarStatus, RentalPeriodicity } from '@/db/schema';
import { readApiError } from '@/lib/api-client';
import { formatDateRu, formatRentalPeriod, formatRub, getTodayIso } from '@/lib/format';
import {
  createDriverSchema,
  endRentalSchema,
  upsertRentalSchema,
  type CarDetailDto,
  type CarSummaryDto,
  type DriverDto,
  type OwnerOptionDto,
  type RentalDto,
  type RentalHistoryItemDto,
} from '@/lib/validation';
import { FeedbackBanner, type FeedbackState } from '../FeedbackBanner';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BTN_CLASS,
  SECONDARY_BTN_CLASS,
  parseOptionalNumber,
  parseRequiredNumber,
} from './shared';

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

/** Rental configuration, inline driver creation, owner assignment, closure, and rental history tab. */
export function RentalTab({
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
    () => car.rental?.startDate ?? getTodayIso(),
  );
  const [managerCommissionPercent, setManagerCommissionPercent] = useState(
    car.rental ? String(car.rental.managerCommissionPercent ?? 0) : '0',
  );
  const [endDate, setEndDate] = useState(() => getTodayIso());

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
    setStartDate(rentalStartDate ?? getTodayIso());
    setManagerCommissionPercent(
      rentalManagerCommissionPercent !== undefined
        ? String(rentalManagerCommissionPercent)
        : '0',
    );
    setEndDate(getTodayIso());
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
    if (savingOwner) return;
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
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Условия аренды
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
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

        <FeedbackBanner feedback={feedback} />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
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

          <button type="submit" disabled={busy} className={PRIMARY_BTN_CLASS}>
            {submitting ? 'Сохранение...' : 'Сохранить аренду'}
          </button>
        </div>
      </form>

      <section
        aria-label="Собственник"
        className="space-y-3 border-t border-[var(--border-subtle)] pt-5"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Собственник
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Привязывается независимо от аренды, используется в кабинете собственника и отчётах.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-xs">
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
            className={`${SECONDARY_BTN_CLASS} w-full shrink-0 sm:w-auto`}
          >
            {savingOwner ? 'Сохранение...' : 'Сохранить собственника'}
          </button>
        </div>

        <FeedbackBanner feedback={ownerFeedback} />
      </section>

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
