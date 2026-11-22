'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Car, Phone, Plus, Search, X } from 'lucide-react';
import type { UserRole } from '@/db/schema';
import { formatRub } from '@/lib/format';
import {
  createDriverSchema,
  type DriverDetailDto,
  type DriverSummaryDto,
} from '@/lib/validation';
import { DriverDetailModal } from './DriverDetailModal';
import { ModalShell } from './ModalShell';

type DriverFilterTab = 'active' | 'debtors' | 'archive';

const FILTER_TABS: Array<{ value: DriverFilterTab; label: string }> = [
  { value: 'active', label: 'Активные' },
  { value: 'debtors', label: 'С долгами' },
  { value: 'archive', label: 'Архив' },
];

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

function toSummaryDto(detail: DriverDetailDto): DriverSummaryDto {
  return {
    id: detail.id,
    fullName: detail.fullName,
    phone: detail.phone,
    notes: detail.notes,
    archived: detail.archived,
    createdAt: detail.createdAt,
    activeCars: detail.activeCars,
    rentDebt30d: detail.rentDebt30d,
    unpaidFinesSum: detail.unpaidFinesSum,
    unpaidFinesCount: detail.unpaidFinesCount,
  };
}

function matchesSearch(driver: DriverSummaryDto, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (driver.fullName.toLowerCase().includes(normalizedQuery)) return true;

  const phone = (driver.phone ?? '').toLowerCase();
  if (phone.includes(normalizedQuery)) return true;

  const digitsQuery = normalizedQuery.replace(/\D/g, '');
  if (digitsQuery.length >= 3 && /^[+\d\s()-]+$/.test(normalizedQuery)) {
    return phone.replace(/\D/g, '').includes(digitsQuery);
  }
  return false;
}

function AddDriverModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (driver: DriverSummaryDto) => void;
}) {
  const fullNameRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setPhone('');
    setNotes('');
    setError(null);
    fullNameRef.current?.focus();
  }, [open]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const parsed = createDriverSchema.safeParse({
      fullName,
      phone,
      notes,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Некорректные данные водителя');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Не удалось добавить водителя');
        return;
      }

      const data = (await response.json()) as { driver?: DriverSummaryDto };
      if (data.driver) {
        onCreated(data.driver);
      }
      onClose();
    } catch {
      setError('Не удалось сохранить водителя. Проверьте сеть');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="Новый водитель"
      onClose={onClose}
      closeDisabled={submitting}
      maxWidthClass="max-w-md"
      zIndexClass="z-50"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
        <div>
          <label htmlFor="add-driver-full-name" className={LABEL_CLASS}>
            ФИО
          </label>
          <input
            ref={fullNameRef}
            id="add-driver-full-name"
            name="fullName"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            disabled={submitting}
            placeholder="Иванов Алексей Сергеевич"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="add-driver-phone" className={LABEL_CLASS}>
            Телефон
          </label>
          <input
            id="add-driver-phone"
            name="phone"
            type="text"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={submitting}
            placeholder="+7 916 111-22-33"
            className={`${INPUT_CLASS} tabular-nums`}
          />
        </div>

        <div>
          <label htmlFor="add-driver-notes" className={LABEL_CLASS}>
            Заметка
          </label>
          <textarea
            id="add-driver-notes"
            name="notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            placeholder="Необязательно"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              backgroundColor: 'var(--status-repair-bg)',
              borderColor: 'var(--status-repair-border)',
              color: 'var(--status-repair-text)',
            }}
            className="rounded-lg border px-3 py-2 text-xs font-medium"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/** Drivers catalog with search, active/debtor/archive tabs, creation modal, and detail sheet. */
export function DriversClient({
  initialDrivers,
  userRole,
}: {
  initialDrivers: DriverSummaryDto[];
  userRole: UserRole;
}) {
  const router = useRouter();
  const [drivers, setDrivers] = useState<DriverSummaryDto[]>(initialDrivers);
  const [filterTab, setFilterTab] = useState<DriverFilterTab>('active');
  const [query, setQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

  useEffect(() => {
    setDrivers(initialDrivers);
  }, [initialDrivers]);

  const activeCount = drivers.filter((driver) => !driver.archived).length;
  const archivedCount = drivers.length - activeCount;
  const normalizedQuery = query.trim().toLowerCase();

  const filteredDrivers = drivers.filter((driver) => {
    if (filterTab === 'active' && driver.archived) return false;
    if (
      filterTab === 'debtors' &&
      (driver.archived || (driver.rentDebt30d <= 0 && driver.unpaidFinesSum <= 0 && driver.unpaidFinesCount <= 0))
    ) {
      return false;
    }
    if (filterTab === 'archive' && !driver.archived) return false;
    return matchesSearch(driver, normalizedQuery);
  });

  function handleDriverCreated(created: DriverSummaryDto) {
    setDrivers((prev) => (prev.some((item) => item.id === created.id) ? prev : [...prev, created]));
    router.refresh();
  }

  function handleDriverUpdated(updated: DriverDetailDto) {
    const summary = toSummaryDto(updated);
    setDrivers((prev) => prev.map((item) => (item.id === summary.id ? summary : item)));
    router.refresh();
  }

  function resetFilters() {
    setFilterTab('active');
    setQuery('');
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            Водители
          </h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
            Активных:{' '}
            <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
              {activeCount}
            </strong>
            {', '}в архиве:{' '}
            <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
              {archivedCount}
            </strong>
          </p>
        </div>

        {userRole === 'admin' && (
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Добавить водителя</span>
          </button>
        )}
      </div>

      <section
        aria-label="Фильтры и поиск"
        className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:mt-5 lg:flex-row lg:items-center lg:justify-between"
      >
        <div role="group" aria-label="Фильтр водителей" className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map((tab) => {
            const active = filterTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilterTab(tab.value)}
                className={
                  active
                    ? 'inline-flex h-9 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors sm:text-sm'
                    : 'inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] sm:text-sm'
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ФИО или телефон"
            aria-label="Поиск по ФИО или телефону"
            className="h-9 w-full appearance-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      {drivers.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">Водителей пока нет</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {userRole === 'admin'
              ? 'Нажмите «Добавить водителя», чтобы создать первую карточку водителя.'
              : 'Попросите администратора добавить водителей.'}
          </p>
        </div>
      ) : filteredDrivers.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            По этим фильтрам водителей нет
          </p>
          {(filterTab !== 'active' || query !== '') && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {filteredDrivers.map((driver) => (
            <button
              key={driver.id}
              type="button"
              onClick={() => setSelectedDriverId(driver.id)}
              className="flex w-full cursor-pointer flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/45 active:bg-[var(--bg-elevated)]"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
                  {driver.fullName}
                </span>
                {driver.archived && (
                  <span
                    style={{
                      backgroundColor: 'var(--status-available-bg)',
                      borderColor: 'var(--status-available-border)',
                      color: 'var(--status-available-text)',
                    }}
                    className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap"
                  >
                    В архиве
                  </span>
                )}
              </span>

              <span className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate tabular-nums">
                  {driver.phone ?? 'Телефон не указан'}
                </span>
              </span>

              <span className="mt-2.5 flex w-full flex-col gap-1 text-xs">
                {driver.activeCars.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                    <Car className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Без машины</span>
                  </span>
                ) : (
                  driver.activeCars.map((car) => (
                    <span
                      key={car.rentalId}
                      className="flex min-w-0 items-center gap-1.5 text-[var(--text-primary)]"
                    >
                      <span className="inline-flex shrink-0 items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                        {car.plate}
                      </span>
                      <span className="min-w-0 truncate text-[var(--text-secondary)]">
                        {car.brand} {car.model}
                      </span>
                    </span>
                  ))
                )}
              </span>

              <span className="mt-3.5 flex w-full flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3 text-xs">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Долг аренды</span>
                  <span
                    style={
                      driver.rentDebt30d > 0
                        ? { color: 'var(--status-overdue-text)' }
                        : undefined
                    }
                    className={`font-medium tabular-nums ${
                      driver.rentDebt30d > 0 ? 'font-semibold' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {formatRub(driver.rentDebt30d)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Штрафы</span>
                  <span
                    style={
                      driver.unpaidFinesCount > 0
                        ? { color: 'var(--status-repair-text)' }
                        : undefined
                    }
                    className={`font-medium tabular-nums ${
                      driver.unpaidFinesCount > 0 ? 'font-semibold' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {driver.unpaidFinesCount > 0
                      ? `${formatRub(driver.unpaidFinesSum)} (${driver.unpaidFinesCount} шт.)`
                      : formatRub(0)}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {userRole === 'admin' && (
        <AddDriverModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onCreated={handleDriverCreated}
        />
      )}

      {selectedDriverId !== null && (
        <DriverDetailModal
          driverId={selectedDriverId}
          userRole={userRole}
          onClose={() => setSelectedDriverId(null)}
          onUpdated={handleDriverUpdated}
        />
      )}
    </main>
  );
}
