'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { shiftUtcDaysIso } from '@/lib/format';
import { formatSignedRubPlain } from '@/lib/reports';
import type { FleetReportDto, ReportPeriodType } from '@/lib/validation';

export type ReportCarOption = {
  id: number;
  plate: string;
  brand: string;
  model: string;
};

type PreviewFormat = 'telegram' | 'plain';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Shift `YYYY-MM` by `deltaMonths` UTC calendar months across year boundaries. */
function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) return yearMonth;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + deltaMonths, 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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

/** Interactive weekly and monthly fleet payout reports with Telegram export. */
export function ReportsClient({
  initialReport,
  cars,
  initialDate,
  initialMonth,
}: {
  initialReport: FleetReportDto;
  cars: ReportCarOption[];
  initialDate: string;
  initialMonth: string;
}) {
  const [report, setReport] = useState<FleetReportDto>(initialReport);
  const [type, setType] = useState<ReportPeriodType>(initialReport.type);
  const [anchorDate, setAnchorDate] = useState<string>(initialDate);
  const [monthValue, setMonthValue] = useState<string>(initialMonth);
  const [selectedCarId, setSelectedCarId] = useState<string>(
    initialReport.carId === null ? '' : String(initialReport.carId),
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

  const skipInitialFetchRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }

    if (type === 'weekly' && !ISO_DATE_RE.test(anchorDate)) return;
    if (type === 'monthly' && !YEAR_MONTH_RE.test(monthValue)) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const params = new URLSearchParams();
    params.set('type', type);
    if (type === 'weekly') {
      params.set('date', anchorDate);
    } else {
      params.set('month', monthValue);
    }
    if (selectedCarId !== '') {
      params.set('carId', selectedCarId);
    }
    params.set(
      'includeMaintenance',
      type === 'monthly' ? 'true' : String(includeMaintenance),
    );

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/reports?${params.toString()}`, {
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
  }, [type, anchorDate, monthValue, selectedCarId, includeMaintenance, retryTick]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
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
      setCopyFeedback(format === 'telegram' ? 'Скопировано для Telegram' : 'Текст скопирован');
      copyTimerRef.current = setTimeout(() => {
        setCopyFeedback(null);
        copyTimerRef.current = null;
      }, 2500);
    } catch {
      setCopyError('Не удалось скопировать в буфер обмена. Скопируйте текст вручную.');
    }
  }

  const reportTitle = report.type === 'weekly' ? 'Еженедельный отчёт' : 'Ежемесячный отчёт';
  const previewText = previewFormat === 'telegram' ? report.textTelegram : report.textPlain;

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            Отчёты
          </h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
            {reportTitle} ({report.periodLabel}) · {report.carLabel}
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
        className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:mt-5 sm:p-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Тип отчёта"
            className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
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
          </div>

          {type === 'weekly' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Предыдущая неделя"
                onClick={() => setAnchorDate((prev) => shiftUtcDaysIso(prev, -7))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              <input
                type="date"
                aria-label="Дата недели"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-sm text-[var(--text-primary)] tabular-nums focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                aria-label="Следующая неделя"
                onClick={() => setAnchorDate((prev) => shiftUtcDaysIso(prev, 7))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Предыдущий месяц"
                onClick={() => setMonthValue((prev) => shiftYearMonth(prev, -1))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
              <input
                type="month"
                aria-label="Месяц отчёта"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-sm text-[var(--text-primary)] tabular-nums focus:border-[var(--border-strong)]"
              />
              <button
                type="button"
                aria-label="Следующий месяц"
                onClick={() => setMonthValue((prev) => shiftYearMonth(prev, 1))}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
          <select
            aria-label="Автомобиль"
            value={selectedCarId}
            onChange={(e) => setSelectedCarId(e.target.value)}
            className="h-9 min-w-[200px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)]"
          >
            <option value="">Все машины</option>
            {cars.map((car) => (
              <option key={car.id} value={String(car.id)}>
                {car.brand} {car.model} ({car.plate})
              </option>
            ))}
          </select>

          {type === 'weekly' ? (
            <label
              htmlFor="report-include-maintenance"
              className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)] select-none"
            >
              <input
                id="report-include-maintenance"
                type="checkbox"
                checked={includeMaintenance}
                onChange={(e) => setIncludeMaintenance(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--accent)]"
              />
              <span>Учитывать ремонт</span>
            </label>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              В ежемесячном отчёте ремонт учитывается всегда
            </p>
          )}
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
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRetryTick((prev) => prev + 1)}
            className="cursor-pointer rounded-lg border border-current px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
          >
            Повторить
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-7">
          <section aria-label="Сводка отчёта" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-medium text-[var(--text-secondary)]">Оплаченная аренда</p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                {formatSignedRubPlain(report.paidRental)}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-medium text-[var(--text-secondary)]">
                Менеджеру автопарка
              </p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                {formatSignedRubPlain(report.managerIncome)}
              </p>
            </div>

            {report.includeMaintenance && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs font-medium text-[var(--text-secondary)]">Ремонт</p>
                <p className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
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
                className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${getPayoutColorClass(
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
                        <th scope="col" className="px-4 py-2.5 font-medium">
                          Машина
                        </th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">
                          Аренда
                        </th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">
                          Менеджер
                        </th>
                        {report.includeMaintenance && (
                          <th scope="col" className="px-3 py-2.5 text-right font-medium">
                            Ремонт
                          </th>
                        )}
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">
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
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[var(--text-primary)]">
                              {car.brand} {car.model}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] tabular-nums">
                              {car.plate}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap text-[var(--text-primary)] tabular-nums">
                            {formatSignedRubPlain(car.paidRental)}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap text-[var(--text-secondary)] tabular-nums">
                            {formatSignedRubPlain(car.managerIncome)}
                          </td>
                          {report.includeMaintenance && (
                            <td className="px-3 py-2.5 text-right whitespace-nowrap text-[var(--text-secondary)] tabular-nums">
                              {formatSignedRubPlain(car.maintenanceCost)}
                            </td>
                          )}
                          <td
                            className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums ${getPayoutColorClass(
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
              className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
            >
              <button
                type="button"
                aria-pressed={previewFormat === 'telegram'}
                onClick={() => setPreviewFormat('telegram')}
                className={
                  previewFormat === 'telegram'
                    ? 'h-7 cursor-pointer rounded-md bg-[var(--accent)] px-2.5 text-xs font-medium text-[var(--accent-fg)] transition-colors'
                    : 'h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
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
                    ? 'h-7 cursor-pointer rounded-md bg-[var(--accent)] px-2.5 text-xs font-medium text-[var(--accent-fg)] transition-colors'
                    : 'h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
                }
              >
                Обычный текст
              </button>
            </div>
          </div>

          <pre className="mt-3 max-h-[460px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-xs leading-relaxed text-[var(--text-primary)] tabular-nums sm:text-sm">
            {previewText}
          </pre>

          <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleCopy('telegram')}
              className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Копировать для Telegram</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopy('plain')}
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
            >
              <span>Копировать текст</span>
            </button>
          </div>

          {copyFeedback && (
            <p
              role="status"
              aria-live="polite"
              className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-[var(--status-rent-text)]"
            >
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
              className="mt-2.5 rounded-lg border px-3 py-2 text-xs font-medium"
            >
              {copyError}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
