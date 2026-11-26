'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, X } from 'lucide-react';
import type { CarStatus, UserRole } from '@/db/schema';
import { formatRub } from '@/lib/format';
import type { CarSummaryDto, FleetDashboardSummary } from '@/lib/validation';
import { AddCarModal } from './AddCarModal';
import { CarCompactCard } from './CarCompactCard';
import { CarDetailModal } from './CarDetailModal';

type StatusFilter = 'all' | CarStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'in_rent', label: 'В аренде' },
  { value: 'in_repair', label: 'В ремонте' },
  { value: 'available', label: 'Не в аренде' },
];

const EMPTY_FLEET_COPY: Record<UserRole, string> = {
  admin: 'Нажмите «Добавить машину», чтобы добавить первую машину и вести аренду, документы и ТО.',
  owner: 'К вашей учётной записи пока не привязаны автомобили.',
  viewer: 'Попросите администратора добавить машины.',
};

function deriveFallbackSummary(carsList: CarSummaryDto[]): FleetDashboardSummary {
  return {
    totalRentDebt30d: carsList.reduce((sum, car) => sum + car.rentDebt30d, 0),
    totalUnpaidFinesSum: carsList.reduce((sum, car) => sum + car.unpaidFinesSum, 0),
    totalUnpaidFinesCount: carsList.reduce((sum, car) => sum + car.unpaidFinesCount, 0),
    paidRental30d: 0,
    managerIncome30d: 0,
    paidRentalMonth: 0,
    managerIncomeMonth: 0,
    maintenanceCost30d: 0,
    netIncome30d: 0,
    urgentDeadlineCarsCount: carsList.filter((car) => car.deadlineStatus !== 'ok').length,
  };
}

function formatSignedRub(amount: number): string {
  if (amount > 0) return `+${formatRub(amount)}`;
  if (amount < 0) return `-${formatRub(Math.abs(amount))}`;
  return formatRub(0);
}

/** Fleet dashboard with 30-day KPI strip, status/deadline/search filters, car grid, and modals. */
export function DashboardClient({
  initialCars,
  initialSummary,
  userRole,
}: {
  initialCars: CarSummaryDto[];
  initialSummary?: FleetDashboardSummary;
  userRole: UserRole;
}) {
  const router = useRouter();
  const [cars, setCars] = useState<CarSummaryDto[]>(initialCars);
  const [summary, setSummary] = useState<FleetDashboardSummary>(
    () => initialSummary ?? deriveFallbackSummary(initialCars),
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [onlyUrgentDeadlines, setOnlyUrgentDeadlines] = useState(false);
  const [query, setQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<number | null>(null);

  useEffect(() => {
    setCars(initialCars);
    setSummary(initialSummary ?? deriveFallbackSummary(initialCars));
  }, [initialCars, initialSummary]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCars = cars.filter((car) => {
    if (statusFilter !== 'all' && car.status !== statusFilter) return false;
    if (onlyUrgentDeadlines && car.deadlineStatus === 'ok') return false;
    if (!normalizedQuery) return true;
    return (
      car.plate.toLowerCase().includes(normalizedQuery) ||
      car.brand.toLowerCase().includes(normalizedQuery) ||
      car.model.toLowerCase().includes(normalizedQuery) ||
      `${car.brand} ${car.model}`.toLowerCase().includes(normalizedQuery) ||
      (car.activeDriverName ?? '').toLowerCase().includes(normalizedQuery) ||
      (car.ownerName ?? '').toLowerCase().includes(normalizedQuery)
    );
  });

  const inRentCount = cars.filter((car) => car.status === 'in_rent').length;
  const hasExpiredDeadlines = cars.some((car) => car.deadlineStatus === 'expired');
  const hasRentDebt = summary.totalRentDebt30d > 0;

  async function refreshCars() {
    try {
      const response = await fetch('/api/cars', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as {
          cars?: CarSummaryDto[];
          summary?: FleetDashboardSummary;
        };
        if (Array.isArray(data.cars)) {
          const nextCars = data.cars;
          setCars(nextCars);
          if (data.summary) {
            setSummary(data.summary);
          } else {
            const fallback = deriveFallbackSummary(nextCars);
            setSummary((prev) => ({
              ...prev,
              totalRentDebt30d: fallback.totalRentDebt30d,
              totalUnpaidFinesSum: fallback.totalUnpaidFinesSum,
              totalUnpaidFinesCount: fallback.totalUnpaidFinesCount,
              urgentDeadlineCarsCount: fallback.urgentDeadlineCarsCount,
            }));
          }
        }
      }
    } catch {
      // Keep UI responsive and rely on router.refresh() below if immediate refetch fails.
    } finally {
      router.refresh();
    }
  }

  function resetFilters() {
    setStatusFilter('all');
    setOnlyUrgentDeadlines(false);
    setQuery('');
  }

  return (
    <main
      data-selected-car-id={selectedCarId ?? undefined}
      className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            Автопарк
          </h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
            Машин:{' '}
            <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
              {cars.length}
            </strong>
            {', '}в аренде:{' '}
            <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
              {inRentCount}
            </strong>
          </p>
        </div>

        {userRole === 'admin' && (
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Добавить машину</span>
          </button>
        )}
      </div>

      <section
        aria-label="Финансовая сводка"
        className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-5 sm:gap-3 lg:grid-cols-4"
      >
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Аренда за месяц</p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-xl">
            {formatRub(summary.paidRentalMonth)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Оплачено с 1-го числа</p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4">
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            Доход менеджера за месяц
          </p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-xl">
            {formatRub(summary.managerIncomeMonth)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Комиссия с оплаченной аренды
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Итог за 30 дней</p>
          <p
            className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums sm:text-xl"
            style={{
              color:
                summary.netIncome30d > 0
                  ? 'var(--status-rent-text)'
                  : summary.netIncome30d < 0
                    ? 'var(--status-repair-text)'
                    : 'var(--text-primary)',
            }}
          >
            {formatSignedRub(summary.netIncome30d)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)] tabular-nums">
            Аренда {formatRub(summary.paidRental30d)}, менеджер{' '}
            {formatRub(summary.managerIncome30d)}, ремонт {formatRub(summary.maintenanceCost30d)}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Долг по аренде</p>
          <p
            className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums sm:text-xl"
            style={{
              color: hasRentDebt ? 'var(--status-overdue-text)' : 'var(--status-rent-text)',
            }}
          >
            {hasRentDebt ? formatRub(summary.totalRentDebt30d) : formatRub(0)}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {hasRentDebt ? 'Просрочено за 30 дн.' : 'Долгов нет'}
          </p>
        </div>
      </section>

      <section
        aria-label="Фильтры и поиск"
        className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:mt-5 lg:flex-row lg:items-center lg:justify-between"
      >
        <div role="group" aria-label="Фильтр по статусу" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((item) => {
            const active = statusFilter === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(item.value)}
                className={
                  active
                    ? 'inline-flex h-9 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors sm:text-sm'
                    : 'inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] sm:text-sm'
                }
              >
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            aria-pressed={onlyUrgentDeadlines}
            onClick={() => setOnlyUrgentDeadlines((prev) => !prev)}
            style={
              onlyUrgentDeadlines
                ? {
                    backgroundColor: 'var(--status-overdue-bg)',
                    borderColor: 'var(--status-overdue-border)',
                    color: 'var(--status-overdue-text)',
                  }
                : undefined
            }
            className={
              onlyUrgentDeadlines
                ? 'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm'
                : 'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] sm:text-sm'
            }
          >
            {summary.urgentDeadlineCarsCount > 0 && (
              <span
                aria-hidden="true"
                style={{
                  backgroundColor: hasExpiredDeadlines
                    ? 'var(--status-repair-dot)'
                    : 'var(--status-overdue)',
                }}
                className="h-1.5 w-1.5 shrink-0 rounded-full"
              />
            )}
            <span>Сроки</span>
            {summary.urgentDeadlineCarsCount > 0 && (
              <>
                {' '}
                <span
                  className={`tabular-nums ${
                    onlyUrgentDeadlines ? 'opacity-80' : 'text-[var(--text-muted)]'
                  }`}
                >
                  ({summary.urgentDeadlineCarsCount})
                </span>
              </>
            )}
          </button>
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
            placeholder="Поиск"
            aria-label="Поиск по номеру, марке, модели, водителю или собственнику"
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

      {cars.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">Машин пока нет</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {EMPTY_FLEET_COPY[userRole]}
          </p>
        </div>
      ) : filteredCars.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            По этим фильтрам машин нет
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCars.map((car) => (
            <CarCompactCard key={car.id} car={car} onSelect={setSelectedCarId} />
          ))}
        </div>
      )}

      {userRole === 'admin' && (
        <AddCarModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onCreated={() => {
            void refreshCars();
          }}
        />
      )}

      {selectedCarId !== null && (
        <CarDetailModal
          carId={selectedCarId}
          userRole={userRole}
          onClose={() => setSelectedCarId(null)}
          onUpdated={() => {
            void refreshCars();
          }}
        />
      )}
    </main>
  );
}