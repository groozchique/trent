'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SHOW_FINES } from '@/lib/features';
import { formatMileage } from '@/lib/format';
import type { CarDetailDto, DriverDto, OwnerOptionDto } from '@/lib/validation';
import { BrandIcon } from './BrandIcon';
import { CarDocumentsTab } from './CarDocumentsTab';
import { StatusBadge } from './StatusBadge';
import { FinesTab } from './car-manage/FinesTab';
import { GeneralInfoTab } from './car-manage/GeneralInfoTab';
import { MaintenanceTab } from './car-manage/MaintenanceTab';
import { RentalTab } from './car-manage/RentalTab';

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

const EMPTY_DRIVERS: DriverDto[] = [];
const EMPTY_OWNERS: OwnerOptionDto[] = [];

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
  const refreshAbortRef = useRef<AbortController | null>(null);

  const driversSignature = drivers
    .map((item) => `${item.id}:${item.fullName}:${item.phone ?? ''}:${item.archived}`)
    .join('|');

  useEffect(() => {
    setCarState(car);
  }, [car]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

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
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      const response = await fetch(`/api/cars/${car.id}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.ok) {
        const data = (await response.json()) as { car?: CarDetailDto };
        if (!controller.signal.aborted && data.car) {
          setCarState(data.car);
        }
      }
    } catch {
      // Keep optimistic state responsive if refetch is aborted or fails.
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        router.refresh();
      }
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
          <span>В панель управления</span>
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
