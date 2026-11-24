import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetReportDto } from '@/lib/validation';
import { ReportsClient, type ReportCarOption } from '@/components/ReportsClient';

const SAMPLE_CARS: ReportCarOption[] = [
  { id: 1, plate: 'А111АА77', brand: 'Kia', model: 'Rio' },
  { id: 2, plate: 'В222ВВ77', brand: 'Hyundai', model: 'Solaris' },
];

function makeReport(overrides: Partial<FleetReportDto> = {}): FleetReportDto {
  const base: FleetReportDto = {
    type: 'weekly',
    periodStart: '2026-11-23',
    periodEnd: '2026-11-29',
    periodLabel: 'неделя с 23.11.2026 по 29.11.2026',
    carId: null,
    carLabel: 'Все машины',
    ownerId: null,
    ownerName: null,
    includeFinancial: true,
    includeMaintenance: false,
    paidRental: 32000,
    managerIncome: 6400,
    maintenanceCost: 0,
    maintenanceCount: 0,
    ownerPayout: 25600,
    cars: [
      {
        carId: 1,
        plate: 'А111АА77',
        brand: 'Kia',
        model: 'Rio',
        paidRental: 20000,
        managerIncome: 4000,
        maintenanceCost: 0,
        ownerPayout: 16000,
        maintenanceItems: [],
      },
      {
        carId: 2,
        plate: 'В222ВВ77',
        brand: 'Hyundai',
        model: 'Solaris',
        paidRental: 12000,
        managerIncome: 2400,
        maintenanceCost: 0,
        ownerPayout: 9600,
        maintenanceItems: [],
      },
    ],
    textPlain: 'Еженедельный отчёт (неделя с 23.11.2026 по 29.11.2026)\nК выплате собственнику: 25 600 ₽',
    textTelegram:
      '**Еженедельный отчёт (неделя с 23.11.2026 по 29.11.2026)**\nК выплате собственнику: **25 600 ₽**',
  };
  return { ...base, ...overrides };
}

describe('ReportsClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders initial weekly report without issuing a mount fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const initialReport = makeReport();
    render(
      <ReportsClient
        initialReport={initialReport}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Отчёты' })).toBeInTheDocument();
    expect(
      screen.getByText('Еженедельный отчёт: неделя с 23.11.2026 по 29.11.2026, Все машины'),
    ).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Сводка отчёта' });
    expect(within(summary).getByText('32 000 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('6 400 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('25 600 ₽')).toBeInTheDocument();
    expect(within(summary).queryByText('Ремонт')).not.toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'Разбивка по машинам' });
    expect(within(breakdown).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(breakdown).getByText('Hyundai Solaris')).toBeInTheDocument();

    expect(screen.getByText(/\*\*Еженедельный отчёт/)).toBeInTheDocument();
  });

  it('toggles includeMaintenance in weekly mode and updates totals, table, and preview', async () => {
    const updated = makeReport({
      includeMaintenance: true,
      maintenanceCost: 5000,
      ownerPayout: 20600,
      cars: [
        {
          carId: 1,
          plate: 'А111АА77',
          brand: 'Kia',
          model: 'Rio',
          paidRental: 20000,
          managerIncome: 4000,
          maintenanceCost: 5000,
          ownerPayout: 11000,
          maintenanceItems: [],
        },
        {
          carId: 2,
          plate: 'В222ВВ77',
          brand: 'Hyundai',
          model: 'Solaris',
          paidRental: 12000,
          managerIncome: 2400,
          maintenanceCost: 0,
          ownerPayout: 9600,
          maintenanceItems: [],
        },
      ],
      textTelegram: '**Еженедельный отчёт с ремонтом**\nРемонт: 5 000 ₽',
      textPlain: 'Еженедельный отчёт с ремонтом\nРемонт: 5 000 ₽',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: updated }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    const checkbox = screen.getByLabelText('Учитывать ремонт');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('type=weekly');
    expect(url).toContain('date=2026-11-25');
    expect(url).toContain('includeMaintenance=true');

    const summary = screen.getByRole('region', { name: 'Сводка отчёта' });
    expect(within(summary).getByText('Ремонт')).toBeInTheDocument();
    expect(within(summary).getByText('5 000 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('20 600 ₽')).toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'Разбивка по машинам' });
    expect(within(breakdown).getByRole('columnheader', { name: 'Ремонт' })).toBeInTheDocument();
    expect(screen.getByText(/\*\*Еженедельный отчёт с ремонтом\*\*/)).toBeInTheDocument();
  });

  it('switches to monthly mode, forces includeMaintenance=true, and shows static maintenance note', async () => {
    const monthlyReport = makeReport({
      type: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      periodLabel: 'Ноябрь 2026',
      includeMaintenance: true,
      paidRental: 90000,
      managerIncome: 18000,
      maintenanceCost: 12000,
      ownerPayout: 60000,
      textTelegram: '**Ежемесячный отчёт (Ноябрь 2026)**',
      textPlain: 'Ежемесячный отчёт (Ноябрь 2026)',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: monthlyReport }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ежемесячный' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('type=monthly');
    expect(url).toContain('month=2026-11');
    expect(url).toContain('includeMaintenance=true');

    expect(screen.queryByLabelText('Учитывать ремонт')).not.toBeInTheDocument();
    expect(
      screen.getByText('В ежемесячном отчёте ремонт учитывается всегда'),
    ).toBeInTheDocument();
    expect(screen.getByText('60 000 ₽')).toBeInTheDocument();
  });

  it('filters by specific car and hides per-car breakdown table', async () => {
    const singleCarReport = makeReport({
      carId: 2,
      carLabel: 'Hyundai Solaris (В222ВВ77)',
      paidRental: 12000,
      managerIncome: 2400,
      ownerPayout: 9600,
      cars: [
        {
          carId: 2,
          plate: 'В222ВВ77',
          brand: 'Hyundai',
          model: 'Solaris',
          paidRental: 12000,
          managerIncome: 2400,
          maintenanceCost: 0,
          ownerPayout: 9600,
          maintenanceItems: [],
        },
      ],
      textTelegram: '**Еженедельный отчёт** Автомобиль: Hyundai Solaris (В222ВВ77)',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report: singleCarReport }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    fireEvent.change(screen.getByLabelText('Автомобиль'), { target: { value: '2' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('carId=2');
    expect(screen.queryByRole('region', { name: 'Разбивка по машинам' })).not.toBeInTheDocument();
    expect(screen.getByText('9 600 ₽')).toBeInTheDocument();
  });

  it('steps weekly and monthly periods across boundaries', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        report: makeReport({
          type: url.includes('type=monthly') ? 'monthly' : 'weekly',
          includeMaintenance: url.includes('includeMaintenance=true'),
        }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-01"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain('date=2026-11-18');

    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('date=2026-11-25');

    fireEvent.click(screen.getByRole('button', { name: 'Ежемесячный' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain('month=2026-01');

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toContain('month=2025-12');

    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4][0]).toContain('month=2026-01');
  });

  it('copies Telegram Markdown and plain text to clipboard with inline status feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: writeTextMock },
    });

    const report = makeReport();
    render(
      <ReportsClient
        initialReport={report}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Копировать для Telegram' }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(report.textTelegram);
    });
    expect(screen.getByText('Скопировано для Telegram')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Копировать текст' }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(report.textPlain);
    });
    expect(screen.getByText('Текст скопирован')).toBeInTheDocument();
  });

  it('aborts in-flight fetch on rapid filter changes and shows error alert while keeping last report', async () => {
    const signals: AbortSignal[] = [];
    let callCount = 0;

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      callCount += 1;
      const currentCall = callCount;
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (currentCall === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }

      if (currentCall === 2) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            report: makeReport({ ownerPayout: 42000 }),
          }),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    fireEvent.click(screen.getByLabelText('Учитывать ремонт'));
    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));

    await waitFor(() => {
      expect(signals[0]?.aborted).toBe(true);
      expect(screen.getByText('42 000 ₽')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить отчёт');
    expect(screen.getByText('42 000 ₽')).toBeInTheDocument();
  });

  it('switches preview format between Telegram Markdown and plain text and handles clipboard failure', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    const report = makeReport({ cars: [] });
    render(
      <ReportsClient
        initialReport={report}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    expect(screen.getByText('Нет данных по машинам за выбранный период')).toBeInTheDocument();
    expect(screen.getByText(/\*\*25 600 ₽\*\*/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Обычный текст' }));
    expect(screen.queryByText(/\*\*25 600 ₽\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText(/К выплате собственнику: 25 600 ₽/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Копировать текст' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось скопировать');
  });

  it('does not fire a redundant mount fetch under React StrictMode', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <ReportsClient
          initialReport={makeReport()}
          cars={SAMPLE_CARS}
          initialDate="2026-11-25"
          initialMonth="2026-11"
        />
      </StrictMode>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears loading when date or month input is cleared mid-flight and recovers via steppers', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (signals.length === 1 || signals.length === 3) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          report: makeReport({
            type: url.includes('type=monthly') ? 'monthly' : 'weekly',
            includeMaintenance: url.includes('includeMaintenance=true'),
          }),
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    // Start in-flight weekly request, then clear date input
    fireEvent.click(screen.getByLabelText('Учитывать ремонт'));
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Дата недели'), { target: { value: '' } });
    expect(signals[0]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    // Clicking week stepper recovers cleanly using initialDate
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('date=2026-11-18');
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    // Switch to monthly (in-flight), then clear month input and recover via month stepper
    fireEvent.click(screen.getByRole('button', { name: 'Ежемесячный' }));
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Месяц отчёта'), { target: { value: '' } });
    expect(signals[2]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toContain('month=2026-12');
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();
  });

  it('retries failed report fetch when clicking Повторить', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Сбой сервера' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          report: makeReport({ includeMaintenance: true, ownerPayout: 19500 }),
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
      />,
    );

    fireEvent.click(screen.getByLabelText('Учитывать ремонт'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить отчёт: Сбой сервера');

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('19 500 ₽')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
