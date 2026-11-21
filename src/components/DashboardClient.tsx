'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, X } from 'lucide-react';
import type { CarStatus, UserRole } from '@/db/schema';
import type { CarSummaryDto } from '@/lib/validation';
import { AddCarModal } from './AddCarModal';
import { CarCompactCard } from './CarCompactCard';

type StatusFilter = 'all' | CarStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'in_rent', label: 'В аренде' },
  { value: 'in_repair', label: 'На ремонте' },
  { value: 'available', label: 'Не в аренде' },
];

/** Fleet dashboard with status/search filtering, summary counts, car grid, and admin creation modal. */
export function DashboardClient({
  initialCars,
  userRole,
}: {
  initialCars: CarSummaryDto[];
  userRole: UserRole;
}) {
  const router = useRouter();
  const [cars, setCars] = useState<CarSummaryDto[]>(initialCars);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<number | null>(null);

  useEffect(() => {
    setCars(initialCars);
  }, [initialCars]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCars = cars.filter((car) => {
    if (statusFilter !== 'all' && car.status !== statusFilter) return false;
    if (!normalizedQuery) return true;
    return (
      car.plate.toLowerCase().includes(normalizedQuery) ||
      car.brand.toLowerCase().includes(normalizedQuery) ||
      car.model.toLowerCase().includes(normalizedQuery) ||
      `${car.brand} ${car.model}`.toLowerCase().includes(normalizedQuery)
    );
  });

  const inRentCount = cars.filter((car) => car.status === 'in_rent').length;
  const totalUnpaidFines = cars.reduce((sum, car) => sum + car.unpaidFinesCount, 0);

  async function handleCarCreated() {
    try {
      const response = await fetch('/api/cars', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { cars?: CarSummaryDto[] };
        if (Array.isArray(data.cars)) {
          setCars(data.cars);
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
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] sm:text-sm">
            <span>
              Машин:{' '}
              <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
                {cars.length}
              </strong>
            </span>
            <span>
              В аренде:{' '}
              <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
                {inRentCount}
              </strong>
            </span>
            <span>
              Неоплаченные штрафы:{' '}
              <strong
                className="font-semibold tabular-nums"
                style={{
                  color:
                    totalUnpaidFines > 0 ? 'var(--status-repair-text)' : 'var(--text-primary)',
                }}
              >
                {totalUnpaidFines}
              </strong>
            </span>
          </div>
        </div>

        {userRole === 'admin' && (
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Добавить машину</span>
          </button>
        )}
      </div>

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
            placeholder="Номер, марка или модель"
            aria-label="Поиск по номеру, марке или модели"
            className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
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
          <p className="text-sm font-medium text-[var(--text-primary)]">
            В автопарке пока нет автомобилей
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {userRole === 'admin'
              ? 'Нажмите «Добавить машину», чтобы завести первый автомобиль и начать учёт аренды, штрафов и ТО.'
              : 'Обратитесь к администратору для добавления автомобилей.'}
          </p>
        </div>
      ) : filteredCars.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Автомобили по выбранным фильтрам не найдены
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
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
            void handleCarCreated();
          }}
        />
      )}
    </main>
  );
}
