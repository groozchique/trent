'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, SlidersHorizontal, Wrench } from 'lucide-react';
import type { RentalPeriodicity, UserRole } from '@/db/schema';
import { CAR_DOCUMENT_LABELS, type DeadlineState } from '@/lib/deadlines';
import type { CarDetailDto, FineDto, MaintenanceDto } from '@/lib/validation';
import { formatDateRu, formatMileage, formatRentalPeriod, formatRub } from '@/lib/format';
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

function formatDateDeadlineHint(daysLeft: number): string | null {
  if (daysLeft < 0) return `просрочено на ${Math.abs(daysLeft)} дн.`;
  if (daysLeft === 0) return 'сегодня';
  if (daysLeft <= 14) return `осталось ${daysLeft} дн.`;
  return null;
}

/** Expanded car modal showing STS, fines, documents/maintenance deadlines, rental + history, and admin link. */
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
  const [showRentalHistory, setShowRentalHistory] = useState(false);
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
          setError(data?.error ?? 'Не удалось загрузить карточку машины');
          return;
        }

        const data = (await response.json()) as { car?: CarDetailDto };
        if (controller.signal.aborted) return;

        if (!data.car) {
          setError('Карточка не загрузилась');
          return;
        }

        setCar(data.car);
      } catch {
        if (!controller.signal.aborted) {
          setError('Не удалось загрузить карточку. Проверьте сеть');
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

  function handleFineUpdated(updatedFine: FineDto) {
    setSelectedFine(updatedFine);
    setCar((prev) => {
      if (!prev) return prev;
      const nextFines = prev.fines.map((item) =>
        item.id === updatedFine.id ? updatedFine : item,
      );
      let unpaidFinesCount = 0;
      let unpaidFinesSum = 0;
      for (const item of nextFines) {
        if (item.status === 'unpaid') {
          unpaidFinesCount += 1;
          unpaidFinesSum += item.amount;
        }
      }
      return {
        ...prev,
        fines: nextFines,
        unpaidFinesCount,
        unpaidFinesSum,
      };
    });
    handleChildUpdated();
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleCar = car && car.id === carId ? car : null;
  const overduePaymentsCount = visibleCar
    ? visibleCar.timeline.filter((item) => item.status === 'overdue').length
    : 0;
  const pastRentals = visibleCar
    ? visibleCar.rentalHistory.filter((item) => !item.active)
    : [];
  const docPolicyByType = new Map(
    (visibleCar?.documents ?? []).map((doc) => [doc.type, doc.policyNumber]),
  );
  const hasAnyDeadlines = visibleCar
    ? visibleCar.deadlines.documents.length > 0 ||
      visibleCar.deadlines.serviceMileage !== null ||
      visibleCar.deadlines.serviceDate !== null
    : false;

  return (
    <>
      <ModalShell
        title={
          visibleCar ? (
            <span className="inline-flex max-w-full min-w-0 items-center gap-2">
              <BrandIcon
                brand={visibleCar.brand}
                className="h-5 w-5 shrink-0 text-[var(--text-secondary)]"
              />
              <span className="truncate">
                {visibleCar.brand} {visibleCar.model}
              </span>
            </span>
          ) : (
            'Карточка машины'
          )
        }
        headerMeta={
          visibleCar ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-xs font-semibold tracking-tight text-[var(--text-primary)] tabular-nums sm:text-sm">
                {visibleCar.plate}
              </span>
              {visibleCar.stsNumber && (
                <span className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 font-mono text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                  СТС: {visibleCar.stsNumber}
                </span>
              )}
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
          <div aria-busy="true" aria-label="Загрузка карточки машины" className="space-y-3">
            <div className="h-20 rounded-xl bg-[var(--bg-elevated)]" />
            <div className="h-28 rounded-xl bg-[var(--bg-elevated)]" />
            <div className="h-12 rounded-xl bg-[var(--bg-elevated)]" />
          </div>
        ) : error && visibleCar === null ? (
          <div className="space-y-3 rounded-xl border border-[var(--status-repair-border)] bg-[var(--status-repair-bg)] p-4">
            <p
              role="alert"
              style={{ color: 'var(--status-repair-text)' }}
              className="text-sm font-medium"
            >
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
                    Неоплаченных: {visibleCar.unpaidFinesCount} (
                    {formatRub(visibleCar.unpaidFinesSum)})
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

            <section aria-label="Документы и ТО" className="space-y-2.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Документы и ТО</h3>

              {!hasAnyDeadlines ? (
                <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
                  Сроки документов и ТО не указаны
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                  {visibleCar.deadlines.documents.map((doc) => {
                    const policyNumber = docPolicyByType.get(doc.type);
                    const hint = formatDateDeadlineHint(doc.daysLeft);
                    return (
                      <li
                        key={doc.type}
                        className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-[var(--text-primary)]">
                            {doc.label || CAR_DOCUMENT_LABELS[doc.type]}
                          </span>
                          {policyNumber && (
                            <span className="ml-2 font-mono text-xs text-[var(--text-secondary)]">
                              {policyNumber}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-[var(--text-primary)] tabular-nums">
                            {formatDateRu(doc.expiresAt)}
                          </span>
                          {hint && (
                            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                              ({hint})
                            </span>
                          )}
                          <DeadlineBadge status={doc.status} />
                        </div>
                      </li>
                    );
                  })}

                  {visibleCar.deadlines.serviceMileage !== null && (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs sm:text-sm">
                      <span className="font-medium text-[var(--text-primary)]">
                        Плановое ТО (пробег)
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)] tabular-nums">
                          {formatMileage(visibleCar.deadlines.serviceMileage.target)}
                        </span>
                        {visibleCar.deadlines.serviceMileage.mileageLeft <= 0 ? (
                          <span className="text-xs text-[var(--text-secondary)]">
                            (пора пройти)
                          </span>
                        ) : visibleCar.deadlines.serviceMileage.status === 'warning' ? (
                          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                            (осталось {formatMileage(visibleCar.deadlines.serviceMileage.mileageLeft)})
                          </span>
                        ) : null}
                        <DeadlineBadge status={visibleCar.deadlines.serviceMileage.status} />
                      </div>
                    </li>
                  )}

                  {visibleCar.deadlines.serviceDate !== null && (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs sm:text-sm">
                      <span className="font-medium text-[var(--text-primary)]">
                        Плановое ТО (дата)
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)] tabular-nums">
                          {formatDateRu(visibleCar.deadlines.serviceDate.target)}
                        </span>
                        {(() => {
                          const hint = formatDateDeadlineHint(
                            visibleCar.deadlines.serviceDate.daysLeft,
                          );
                          return hint ? (
                            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                              ({hint})
                            </span>
                          ) : null;
                        })()}
                        <DeadlineBadge status={visibleCar.deadlines.serviceDate.status} />
                      </div>
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section aria-label="Аренда" className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Аренда</h3>
                {visibleCar.rentDebt30d > 0 && (
                  <span
                    style={{
                      backgroundColor: 'var(--status-overdue-bg)',
                      borderColor: 'var(--status-overdue-border)',
                      color: 'var(--status-overdue-text)',
                    }}
                    className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
                  >
                    Долг (30 дн.): {formatRub(visibleCar.rentDebt30d)}
                  </span>
                )}
              </div>

              {visibleCar.rental ? (
                <button
                  type="button"
                  onClick={() => setShowTimeline(true)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {visibleCar.rental.renterName}
                      </span>
                      {visibleCar.rental.driverPhone && (
                        <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                          {visibleCar.rental.driverPhone}
                        </span>
                      )}
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

              {pastRentals.length > 0 && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                  <button
                    type="button"
                    aria-expanded={showRentalHistory}
                    onClick={() => setShowRentalHistory((prev) => !prev)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                  >
                    <span>История аренд ({pastRentals.length})</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform ${
                        showRentalHistory ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showRentalHistory && (
                    <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                      {pastRentals.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--text-primary)]">
                              {item.renterName}
                            </p>
                            <p className="mt-0.5 text-[var(--text-secondary)] tabular-nums">
                              {formatRentalPeriod(item.startDate, item.endDate)}
                              {item.driverPhone ? `, ${item.driverPhone}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--text-primary)] tabular-nums">
                              {formatRub(item.rateAmount)}{' '}
                              {PERIODICITY_RATE_LABEL[item.periodicity]}
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
                </div>
              )}
            </section>

            <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setShowServiceHistory(true)}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <Wrench
                  className="h-4 w-4 shrink-0 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
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
        <FineDetailModal
          carId={visibleCar?.id}
          fine={selectedFine}
          userRole={userRole}
          onUpdated={handleFineUpdated}
          onClose={() => setSelectedFine(null)}
        />
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