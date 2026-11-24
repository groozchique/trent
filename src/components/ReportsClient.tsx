'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { formatDateRu, formatMileage, formatSignedRubPlain, shiftUtcDaysIso } from '@/lib/format';
import type { FleetReportDto, OwnerOptionDto, ReportPeriodType } from '@/lib/validation';

export type ReportCarOption = {
  id: number;
  plate: string;
  brand: string;
  model: string;
};

type PreviewFormat = 'telegram' | 'plain';

const EMPTY_OWNERS: OwnerOptionDto[] = [];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^(20\d{2}|2100)$/;

const REPORT_TITLES: Record<ReportPeriodType, string> = {
  weekly: 'Еженедельный отчёт',
  monthly: 'Ежемесячный отчёт',
  yearly: 'Ежегодный отчёт',
};

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function getInitialScopeValue(report: FleetReportDto): string {
  if (report.ownerId !== null) return `owner:${report.ownerId}`;
  if (report.carId !== null) return `car:${report.carId}`;
  return '';
}

function buildReportQueryString(params: {
  type: ReportPeriodType;
  anchorDate: string;
  monthValue: string;
  yearValue: string;
  scopeValue: string;
  includeFinancial: boolean;
  includeMaintenance: boolean;
}): string {
  const search = new URLSearchParams();
  search.set('type', params.type);
  if (params.type === 'weekly') {
    search.set('date', params.anchorDate);
  } else if (params.type === 'monthly') {
    search.set('month', params.monthValue);
  } else {
    search.set('year', params.yearValue);
  }
  if (params.scopeValue.startsWith('owner:')) {
    search.set('ownerId', params.scopeValue.slice(6));
  } else if (params.scopeValue.startsWith('car:')) {
    search.set('carId', params.scopeValue.slice(4));
  }
  search.set('includeFinancial', String(params.includeFinancial));
  search.set('includeMaintenance', String(params.includeMaintenance));
  return search.toString();
}

/** Shift `YYYY-MM` by `deltaMonths` UTC calendar months across year boundaries. */
function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) return yearMonth;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + deltaMonths, 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Shift `YYYY` within the supported 2000..2100 reporting range. */
function shiftYear(yearValue: string, deltaYears: number, fallbackYear: string): string {
  const base = YEAR_RE.test(yearValue)
    ? Number(yearValue)
    : YEAR_RE.test(fallbackYear)
      ? Number(fallbackYear)
      : 2026;
  return String(Math.min(2100, Math.max(2000, base + deltaYears)));
}

function getPayoutColorClass(amount: number): string {
  if (amount > 0) return 'text-[var(--status-rent-text)]';
  if (amount < 0) return 'text-[var(--status-repair-text)]';
  return 'text-[var(--text-primary)]';
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/** Interactive weekly, monthly, and yearly fleet reports with owner/car scoping and Telegram export. */
export function ReportsClient({
  initialReport,
  cars,
  owners = EMPTY_OWNERS,
  initialDate,
  initialMonth,
  initialYear = initialMonth.slice(0, 4),
}: {
  initialReport: FleetReportDto;
  cars: ReportCarOption[];
  owners?: OwnerOptionDto[];
  initialDate: string;
  initialMonth: string;
  initialYear?: string;
}) {
  const [report, setReport] = useState<FleetReportDto>(initialReport);
  const [type, setType] = useState<ReportPeriodType>(initialReport.type);
  const [anchorDate, setAnchorDate] = useState<string>(initialDate);
  const [monthValue, setMonthValue] = useState<string>(initialMonth);
  const [yearValue, setYearValue] = useState<string>(initialYear);
  const [scopeValue, setScopeValue] = useState<string>(() => getInitialScopeValue(initialReport));
  const [includeFinancial, setIncludeFinancial] = useState<boolean>(
    initialReport.includeFinancial,
  );
  const [includeMaintenance, setIncludeMaintenance] = useState<boolean>(
    initialReport.includeMaintenance,
  );
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>('telegram');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState<number>(0);

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const lastQueryKeyRef = useRef<string>(
    `${buildReportQueryString({
      type: initialReport.type,
      anchorDate: initialDate,
      monthValue: initialMonth,
      yearValue: initialYear,
      scopeValue: getInitialScopeValue(initialReport),
      includeFinancial: initialReport.includeFinancial,
      includeMaintenance: initialReport.includeMaintenance,
    })}|0`,
  );
  const mountedRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (
      (type === 'weekly' && !isValidIsoDate(anchorDate)) ||
      (type === 'monthly' && !YEAR_MONTH_RE.test(monthValue)) ||
      (type === 'yearly' && !YEAR_RE.test(yearValue))
    ) {
      lastQueryKeyRef.current = 'invalid';
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    const queryString = buildReportQueryString({
      type,
      anchorDate,
      monthValue,
      yearValue,
      scopeValue,
      includeFinancial,
      includeMaintenance,
    });
    const queryKey = `${queryString}|${retryTick}`;
    if (lastQueryKeyRef.current === queryKey) {
      return;
    }
    lastQueryKeyRef.current = queryKey;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/reports?${queryString}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Не удалось загрузить отчёт');
        }
        const data = (await response.json()) as { report?: FleetReportDto };
        if (!data.report) {
          throw new Error('Не удалось загрузить отчёт');
        }
        if (!controller.signal.aborted) {
          setReport(data.report);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }
        const message =
          err instanceof Error && err.message ? err.message : 'Не удалось загрузить отчёт';
        setError(
          message.includes('Не удалось загрузить отчёт')
            ? message
            : `Не удалось загрузить отчёт: ${message}`,
        );
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [type, anchorDate, monthValue, yearValue, scopeValue, includeFinancial, includeMaintenance, retryTick]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  async function handleCopy(format: PreviewFormat) {
    setCopyError(null);
    setCopyFeedback(null);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }

    const text = format === 'telegram' ? report.textTelegram : report.textPlain;
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await clipboard.writeText(text);
      if (!mountedRef.current) return;
      setCopyFeedback(format === 'telegram' ? 'Скопировано для Telegram' : 'Текст скопирован');
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        if (mountedRef.current) {
          setCopyFeedback(null);
        }
      }, 2500);
    } catch {
      if (!mountedRef.current) return;
      setCopyError('Не удалось скопировать в буфер обмена. Скопируйте текст вручную.');
    }
  }

  function handleToggleFinancial(checked: boolean) {
    if (!checked && !includeMaintenance) return;
    setIncludeFinancial(checked);
  }

  function handleToggleMaintenance(checked: boolean) {
    if (!checked && !includeFinancial) return;
    setIncludeMaintenance(checked);
  }

  const financialLocked = includeFinancial && !includeMaintenance;
  const maintenanceLocked = includeMaintenance && !includeFinancial;
  const reportTitle = REPORT_TITLES[report.type];
  const scopeSubtitle = report.ownerName ? `Собственник: ${report.ownerName}` : report.carLabel;
  const previewText = previewFormat === 'telegram' ? report.textTelegram : report.textPlain;
  const carsWithMaintenance = report.cars.filter((car) => car.maintenanceItems.length > 0);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            Отчёты
          </h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
            {reportTitle}: {report.periodLabel}, {scopeSubtitle}
          </p>
        </div>

        {loading && (
          <p
            role="status"
            aria-live="polite"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Загрузка...
          </p>
        )}
      </div>

      <section
        aria-label="Параметры отчёта"
        className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:mt-6 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Тип отчёта"
            className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1"
          >
            <button
              type="button"
              aria-pressed={type === 'weekly'}
              onClick={() => setType('weekly')}
              className={
                type === 'weekly'
                  ? 'h-8 cursor-pointer rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors sm:text-sm'
                  : 'h-8 cursor-pointer rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:text-sm'
              }
            >
              Еженедельный
            </button>
            <button
              type="button"
              aria-pressed={type === 'monthly'}
              onClick={() => setType('monthly')}
              className={
                type === 'monthly'
                  ? 'h-8 cursor-pointer rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors sm:text-sm'
                  : 'h-8 cursor-pointer rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:text-sm'
              }
            >
              Ежемесячный
            </button>
            <button
              type="button"
              aria-pressed={type === 'yearly'}
              onClick={() => setType('yearly')}
              className={
                type === 'yearly'
                  ? 'h-8 cursor-pointer rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors sm:text-sm'
                  : 'h-8 cursor-pointer rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:text-sm'
              }
            >
              Ежегодный
            </button>
          </div>

          {type === 'weekly' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Предыдущая неделя"
                onClick={() =>
                  setAnchorDate((prev) =>
                    shiftUtcDaysIso(isValidIsoDate(prev) ? prev : initialDate, -7),
                  )
                }
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              <input
                type="date"
                aria-label="Дата недели"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] tabular-nums focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                aria-label="Следующая неделя"
                onClick={() =>
                  setAnchorDate((prev) =>
                    shiftUtcDaysIso(isValidIsoDate(prev) ? prev : initialDate, 7),
                  )
                }
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          )}

          {type === 'monthly' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Предыдущий месяц"
                onClick={() =>
                  setMonthValue((prev) =>
                    shiftYearMonth(YEAR_MONTH_RE.test(prev) ? prev : initialMonth, -1),
                  )
                }
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              <input
                type="month"
                aria-label="Месяц отчёта"
                placeholder="ГГГГ-ММ"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] tabular-nums focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                aria-label="Следующий месяц"
                onClick={() =>
                  setMonthValue((prev) =>
                    shiftYearMonth(YEAR_MONTH_RE.test(prev) ? prev : initialMonth, 1),
                  )
                }
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          )}

          {type === 'yearly' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Предыдущий год"
                onClick={() => setYearValue((prev) => shiftYear(prev, -1, initialYear))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              <input
                type="number"
                min={2000}
                max={2100}
                step={1}
                inputMode="numeric"
                aria-label="Год отчёта"
                value={yearValue}
                onChange={(e) => setYearValue(e.target.value)}
                className="h-9 w-24 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] tabular-nums focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                aria-label="Следующий год"
                onClick={() => setYearValue((prev) => shiftYear(prev, 1, initialYear))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end">
          <select
            aria-label="Автомобиль или собственник"
            value={scopeValue}
            onChange={(e) => setScopeValue(e.target.value)}
            className="h-9 min-w-[220px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)]"
          >
            <option value="">Все машины</option>
            {owners.length > 0 && (
              <optgroup label="По собственнику">
                {owners.map((owner) => (
                  <option key={owner.id} value={`owner:${owner.id}`}>
                    {owner.label}
                  </option>
                ))}
              </optgroup>
            )}
            {cars.length > 0 && (
              <optgroup label="По автомобилю">
                {cars.map((car) => (
                  <option key={car.id} value={`car:${car.id}`}>
                    {car.brand} {car.model} ({car.plate})
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <div className="flex flex-wrap items-center gap-4">
            <label
              htmlFor="report-include-financial"
              className={`inline-flex items-center gap-2 text-sm text-[var(--text-primary)] select-none ${
                financialLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <input
                id="report-include-financial"
                type="checkbox"
                checked={includeFinancial}
                disabled={financialLocked}
                onChange={(e) => handleToggleFinancial(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--accent)] disabled:cursor-not-allowed"
              />
              <span>Финансовый отчёт</span>
            </label>

            <label
              htmlFor="report-include-maintenance"
              className={`inline-flex items-center gap-2 text-sm text-[var(--text-primary)] select-none ${
                maintenanceLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <input
                id="report-include-maintenance"
                type="checkbox"
                checked={includeMaintenance}
                disabled={maintenanceLocked}
                onChange={(e) => handleToggleMaintenance(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--accent)] disabled:cursor-not-allowed"
              />
              <span>Отчёт по ремонту</span>
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--status-repair-bg)',
            borderColor: 'var(--status-repair-border)',
            color: 'var(--status-repair-text)',
          }}
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-medium"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetryTick((prev) => prev + 1)}
            className="cursor-pointer rounded-lg border border-current px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
          >
            Повторить
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-7">
          {report.includeFinancial && (
            <>
              <section
                aria-label="Сводка отчёта"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">
                    Оплаченная аренда
                  </p>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                    {formatSignedRubPlain(report.paidRental)}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">
                    Менеджеру автопарка
                  </p>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                    {formatSignedRubPlain(report.managerIncome)}
                  </p>
                </div>

                {report.includeMaintenance && (
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Ремонт</p>
                    <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                      {formatSignedRubPlain(report.maintenanceCost)}
                    </p>
                  </div>
                )}

                <div
                  className={`rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 ${
                    !report.includeMaintenance ? 'sm:col-span-2' : ''
                  }`}
                >
                  <p className="text-xs font-medium text-[var(--text-secondary)]">
                    К выплате собственнику
                  </p>
                  <p
                    className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${getPayoutColorClass(
                      report.ownerPayout,
                    )}`}
                  >
                    {formatSignedRubPlain(report.ownerPayout)}
                  </p>
                </div>
              </section>

              {report.carId === null && (
                <section
                  aria-label="Разбивка по машинам"
                  className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Разбивка по машинам
                    </h2>
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                      {report.cars.length}
                    </span>
                  </div>

                  {report.cars.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                      Нет данных по машинам за выбранный период
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-secondary)]">
                            <th scope="col" className="px-4 py-3 font-medium">
                              Машина
                            </th>
                            <th scope="col" className="px-3 py-3 text-right font-medium">
                              Аренда
                            </th>
                            <th scope="col" className="px-3 py-3 text-right font-medium">
                              Менеджер
                            </th>
                            {report.includeMaintenance && (
                              <th scope="col" className="px-3 py-3 text-right font-medium">
                                Ремонт
                              </th>
                            )}
                            <th scope="col" className="px-4 py-3 text-right font-medium">
                              Собственнику
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {report.cars.map((car) => (
                            <tr
                              key={car.carId}
                              className="transition-colors hover:bg-[var(--bg-elevated)]"
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium text-[var(--text-primary)]">
                                  {car.brand} {car.model}
                                </div>
                                <div className="text-xs text-[var(--text-muted)] tabular-nums">
                                  {car.plate}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right whitespace-nowrap text-[var(--text-primary)] tabular-nums">
                                {formatSignedRubPlain(car.paidRental)}
                              </td>
                              <td className="px-3 py-3 text-right whitespace-nowrap text-[var(--text-secondary)] tabular-nums">
                                {formatSignedRubPlain(car.managerIncome)}
                              </td>
                              {report.includeMaintenance && (
                                <td className="px-3 py-3 text-right whitespace-nowrap text-[var(--text-secondary)] tabular-nums">
                                  {formatSignedRubPlain(car.maintenanceCost)}
                                </td>
                              )}
                              <td
                                className={`px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums ${getPayoutColorClass(
                                  car.ownerPayout,
                                )}`}
                              >
                                {formatSignedRubPlain(car.ownerPayout)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {report.includeMaintenance && (
            <>
              {!report.includeFinancial && (
                <section
                  aria-label="Сводка по ремонту"
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      Итого на ремонт
                    </p>
                    <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                      {formatSignedRubPlain(report.maintenanceCost)}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      Записей о ремонте
                    </p>
                    <p className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                      {report.maintenanceCount}
                    </p>
                  </div>
                </section>
              )}

              <section
                aria-label="Отчёт по ремонту"
                className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Отчёт по ремонту
                    </h2>
                    <span className="inline-flex h-5 items-center rounded-md bg-[var(--bg-elevated)] px-2 text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                      {report.maintenanceCount}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatSignedRubPlain(report.maintenanceCost)}
                  </span>
                </div>

                {report.maintenanceCount === 0 || carsWithMaintenance.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                    За выбранный период записей о ремонте нет
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {carsWithMaintenance.map((car) => (
                      <div key={car.carId}>
                        {report.carId === null && (
                          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-2">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)]">
                                {car.brand} {car.model}
                              </span>
                              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                                {car.plate}
                              </span>
                            </div>
                            <span className="text-xs font-semibold whitespace-nowrap text-[var(--text-primary)] tabular-nums">
                              {formatSignedRubPlain(car.maintenanceCost)}
                            </span>
                          </div>
                        )}

                        <ul className="divide-y divide-[var(--border-subtle)]">
                          {car.maintenanceItems.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--bg-elevated)]"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)]">
                                  {item.title}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] tabular-nums">
                                  <span>{formatDateRu(item.performedAt)}</span>
                                  <span>{formatMileage(item.mileage)}</span>
                                </div>
                              </div>
                              <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-[var(--text-primary)] tabular-nums">
                                {formatSignedRubPlain(item.totalCost)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <aside
          aria-label="Сообщение для Telegram"
          className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 sm:p-5 lg:sticky lg:top-20 lg:col-span-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Сообщение для Telegram
            </h2>

            <div
              role="group"
              aria-label="Формат текста"
              className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1"
            >
              <button
                type="button"
                aria-pressed={previewFormat === 'telegram'}
                onClick={() => setPreviewFormat('telegram')}
                className={
                  previewFormat === 'telegram'
                    ? 'h-7 cursor-pointer rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors'
                    : 'h-7 cursor-pointer rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
                }
              >
                Telegram Markdown
              </button>
              <button
                type="button"
                aria-pressed={previewFormat === 'plain'}
                onClick={() => setPreviewFormat('plain')}
                className={
                  previewFormat === 'plain'
                    ? 'h-7 cursor-pointer rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors'
                    : 'h-7 cursor-pointer rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
                }
              >
                Обычный текст
              </button>
            </div>
          </div>

          <pre className="mt-3 max-h-[460px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 text-xs leading-relaxed text-[var(--text-primary)] tabular-nums sm:text-sm">
            {previewText}
          </pre>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleCopy('telegram')}
              className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Копировать для Telegram</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopy('plain')}
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
            >
              <span>Копировать текст</span>
            </button>
          </div>

          {copyFeedback && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 flex items-center gap-2 text-xs font-medium text-[var(--status-rent-text)]"
            >
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{copyFeedback}</span>
            </p>
          )}

          {copyError && (
            <p
              role="alert"
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="mt-3 rounded-lg border px-3 py-2 text-xs font-medium"
            >
              {copyError}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
