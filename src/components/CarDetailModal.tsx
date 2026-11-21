'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, SlidersHorizontal, Wrench } from 'lucide-react';
import type { RentalPeriodicity, UserRole } from '@/db/schema';
import type { CarDetailDto, FineDto, MaintenanceDto } from '@/lib/validation';
import { formatMileage, formatRub } from '@/lib/format';
import { BrandIcon } from './BrandIcon';
import { FineDetailModal } from './FineDetailModal';
import { FineListRow, FinesListModal } from './FinesListModal';
import { ModalShell } from './ModalShell';
import { RentalTimelineModal } from './RentalTimelineModal';
import { ServiceDetailModal } from './ServiceDetailModal';
import { ServiceHistoryModal } from './ServiceHistoryModal';
import { StatusBadge } from './StatusBadge';

const PERIODICITY_RATE_LABEL: Record<RentalPeriodicity, string> = {
  daily: 'в день',
  weekly: 'в неделю',
  monthly: 'в месяц',
};

/** Expanded car modal showing summary, up to 3 fines, rental summary, service history, and admin link. */
export function CarDetailModal({
  carId,
  userRole,
  onClose,
  onUpdated,
}: {
  carId: number;
  userRole: UserRole;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [car, setCar] = useState<CarDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [showAllFines, setShowAllFines] = useState(false);
  const [selectedFine, setSelectedFine] = useState<FineDto | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showServiceHistory, setShowServiceHistory] = useState(false);
  const [selectedService, setSelectedService] = useState<MaintenanceDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    async function loadCar() {
      try {
        const response = await fetch(`/api/cars/${carId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? 'Не удалось загрузить данные автомобиля');
          return;
        }

        const data = (await response.json()) as { car?: CarDetailDto };
        if (controller.signal.aborted) return;

        if (!data.car) {
          setError('Данные автомобиля не получены');
          return;
        }

        setCar(data.car);
      } catch {
        if (!controller.signal.aborted) {
          setError('Не удалось загрузить данные автомобиля. Проверьте подключение');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCar();
    return () => controller.abort();
  }, [carId, reloadNonce]);

  function handleChildUpdated() {
    setReloadNonce((n) => n + 1);
    onUpdated();
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleCar = car && car.id === carId ? car : null;
  const overduePaymentsCount = visibleCar
    ? visibleCar.timeline.filter((item) => item.status === 'overdue').length
    : 0;

  return (
    <>
      <ModalShell
        title={
          visibleCar ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <BrandIcon
                brand={visibleCar.brand}
                className="h-5 w-5 shrink-0 text-[var(--text-secondary)]"
              />
              <span className="truncate">
                {visibleCar.brand} {visibleCar.model}
              </span>
            </span>
          ) : (
            'Карточка автомобиля'
          )
        }
        headerMeta={
          visibleCar ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-xs font-bold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-sm">
                {visibleCar.plate}
              </span>
              <StatusBadge status={visibleCar.status} />
              <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums sm:text-sm">
                {formatMileage(visibleCar.mileage)}
              </span>
            </div>
          ) : undefined
        }
        onClose={onClose}
        maxWidthClass="max-w-2xl"
        zIndexClass="z-50"
      >
        {loading && visibleCar === null ? (
          <div aria-busy="true" aria-label="Загрузка карточки автомобиля" className="space-y-3">
            <div className="h-20 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            <div className="h-28 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            <div className="h-12 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          </div>
        ) : error && visibleCar === null ? (
          <div className="space-y-3 rounded-xl border border-[var(--status-repair-border)] bg-[var(--status-repair-bg)] p-4">
            <p role="alert" style={{ color: 'var(--status-repair-text)' }} className="text-sm font-medium">
              {error}
            </p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
            >
              Повторить
            </button>
          </div>
        ) : visibleCar ? (
          <div className="space-y-5">
            <section aria-label="Штрафы" className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Штрафы</h3>
                {visibleCar.unpaidFinesCount > 0 && (
                  <span
                    style={{ color: 'var(--status-repair-text)' }}
                    className="text-xs font-medium tabular-nums"
                  >
                    Неоплаченных: {visibleCar.unpaidFinesCount}
                  </span>
                )}
              </div>

              {visibleCar.fines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
                  Штрафов нет
                </p>
              ) : (
                <div className="space-y-2">
                  <ul className="space-y-2">
                    {visibleCar.fines.slice(0, 3).map((fine) => (
                      <li key={fine.id}>
                        <FineListRow
                          fine={fine}
                          todayIso={todayIso}
                          onSelect={(item) => setSelectedFine(item)}
                        />
                      </li>
                    ))}
                  </ul>

                  {visibleCar.fines.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllFines(true)}
                      className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
                    >
                      Посмотреть все ({visibleCar.fines.length})
                    </button>
                  )}
                </div>
              )}
            </section>

            <section aria-label="Аренда" className="space-y-2.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Аренда</h3>

              {visibleCar.rental ? (
                <button
                  type="button"
                  onClick={() => setShowTimeline(true)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                      {visibleCar.rental.renterName}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-secondary)]">
                      <span className="font-medium text-[var(--text-primary)] tabular-nums">
                        {formatRub(visibleCar.rental.rateAmount)}{' '}
                        {PERIODICITY_RATE_LABEL[visibleCar.rental.periodicity]}
                      </span>
                      {!visibleCar.rental.active && <span>Аренда приостановлена</span>}
                      {overduePaymentsCount > 0 && (
                        <span
                          style={{
                            backgroundColor: 'var(--status-overdue-bg)',
                            borderColor: 'var(--status-overdue-border)',
                            color: 'var(--status-overdue-text)',
                          }}
                          className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
                        >
                          Просрочено: {overduePaymentsCount}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                    <span className="hidden sm:inline">Таймлайн</span>
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </span>
                </button>
              ) : (
                <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
                  Аренда не назначена
                </p>
              )}
            </section>

            <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setShowServiceHistory(true)}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <Wrench className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                <span>История ремонта</span>
                {visibleCar.maintenance.length > 0 && (
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
                    {visibleCar.maintenance.length}
                  </span>
                )}
              </button>

              {userRole === 'admin' && (
                <Link
                  href={`/cars/${visibleCar.id}/manage`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
                >
                  <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Управление</span>
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </ModalShell>

      {visibleCar && showAllFines && (
        <FinesListModal
          fines={visibleCar.fines}
          onSelectFine={(fine) => setSelectedFine(fine)}
          onClose={() => setShowAllFines(false)}
        />
      )}

      {selectedFine && (
        <FineDetailModal fine={selectedFine} onClose={() => setSelectedFine(null)} />
      )}

      {visibleCar && showTimeline && (
        <RentalTimelineModal
          carId={visibleCar.id}
          rental={visibleCar.rental}
          timeline={visibleCar.timeline}
          userRole={userRole}
          onClose={() => setShowTimeline(false)}
          onUpdated={handleChildUpdated}
        />
      )}

      {visibleCar && showServiceHistory && (
        <ServiceHistoryModal
          records={visibleCar.maintenance}
          onSelectRecord={(record) => setSelectedService(record)}
          onClose={() => setShowServiceHistory(false)}
        />
      )}

      {selectedService && (
        <ServiceDetailModal
          record={selectedService}
          onClose={() => setSelectedService(null)}
        />
      )}
    </>
  );
}
