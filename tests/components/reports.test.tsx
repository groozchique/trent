import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionUser } from '@/lib/auth/session';
import type { FleetReportDto, OwnerOptionDto } from '@/lib/validation';

const redirectMock = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getCurrentUserMock = vi.fn<() => Promise<SessionUser | null>>();
const listOwnersMock = vi.fn<() => Promise<OwnerOptionDto[]>>();
const buildReportMock = vi.fn();
const getIsoWeekRangeMock = vi.fn(() => ({ start: '2026-11-23', end: '2026-11-29' }));
const getTodayIsoMock = vi.fn(() => '2026-11-25');
const dbOrderByMock = vi.fn();
const dbFromMock = vi.fn(() => ({ orderBy: dbOrderByMock }));
const dbSelectMock = vi.fn(() => ({ from: dbFromMock }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock('@/db', () => ({
  db: {
    select: () => dbSelectMock(),
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock('@/lib/users', () => ({
  listOwners: () => listOwnersMock(),
}));

vi.mock('@/lib/cars', () => ({
  getTodayIso: () => getTodayIsoMock(),
}));

vi.mock('@/lib/reports', () => ({
  buildReport: (...args: unknown[]) => buildReportMock(...args),
  getIsoWeekRange: () => getIsoWeekRangeMock(),
}));

import ReportsPage from '@/app/reports/page';
import { ReportsClient, type ReportCarOption } from '@/components/ReportsClient';

const SAMPLE_CARS: ReportCarOption[] = [
  { id: 1, plate: 'А111АА77', brand: 'Kia', model: 'Rio' },
  { id: 2, plate: 'В222ВВ77', brand: 'Hyundai', model: 'Solaris' },
];

const SAMPLE_OWNERS: OwnerOptionDto[] = [
  { id: 5, username: 'volkov', displayName: 'Сергей Волков', label: 'Сергей Волков' },
  { id: 6, username: 'ivanov', displayName: null, label: 'ivanov' },
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

describe('ReportsPage SSR guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
    listOwnersMock.mockReset();
    buildReportMock.mockReset();
    dbOrderByMock.mockReset();
    dbSelectMock.mockClear();
    dbFromMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated guest to /login', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(ReportsPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(listOwnersMock).not.toHaveBeenCalled();
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  it('redirects owner user to /', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 5, username: 'volkov', role: 'owner' });

    await expect(ReportsPage()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(listOwnersMock).not.toHaveBeenCalled();
    expect(buildReportMock).not.toHaveBeenCalled();
  });

  it('loads owners, cars, and initial weekly report for viewer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getCurrentUserMock.mockResolvedValue({ id: 2, username: 'viewer', role: 'viewer' });
    dbOrderByMock.mockResolvedValue(SAMPLE_CARS);
    listOwnersMock.mockResolvedValue(SAMPLE_OWNERS);
    buildReportMock.mockResolvedValue(makeReport());

    const element = await ReportsPage();
    render(element);

    expect(buildReportMock).toHaveBeenCalledWith(expect.anything(), {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      ownerId: null,
      includeFinancial: true,
      includeMaintenance: false,
    });
    expect(listOwnersMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Сергей Волков' })).toBeInTheDocument();
  });

  it('loads owners, cars, and initial weekly report for admin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });
    dbOrderByMock.mockResolvedValue(SAMPLE_CARS);
    listOwnersMock.mockResolvedValue(SAMPLE_OWNERS);
    buildReportMock.mockResolvedValue(makeReport());

    const element = await ReportsPage();
    render(element);

    expect(buildReportMock).toHaveBeenCalledWith(expect.anything(), {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      ownerId: null,
      includeFinancial: true,
      includeMaintenance: false,
    });
    expect(screen.getByRole('heading', { name: 'Отчёты' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ReportsClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders initial weekly report with financial checked/disabled and maintenance unchecked', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const initialReport = makeReport();
    render(
      <ReportsClient
        initialReport={initialReport}
        cars={SAMPLE_CARS}
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Отчёты' })).toBeInTheDocument();
    expect(
      screen.getByText('Еженедельный отчёт: неделя с 23.11.2026 по 29.11.2026, Все машины'),
    ).toBeInTheDocument();

    const financialCheckbox = screen.getByRole('checkbox', { name: 'Финансовый отчёт' }) as HTMLInputElement;
    const maintenanceCheckbox = screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }) as HTMLInputElement;
    expect(financialCheckbox.checked).toBe(true);
    expect(financialCheckbox.disabled).toBe(true);
    expect(maintenanceCheckbox.checked).toBe(false);
    expect(maintenanceCheckbox.disabled).toBe(false);

    // Attempting to uncheck the only active section does nothing
    fireEvent.click(financialCheckbox);
    expect(financialCheckbox.checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const summary = screen.getByRole('region', { name: 'Сводка отчёта' });
    expect(within(summary).getByText('32 000 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('6 400 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('25 600 ₽')).toBeInTheDocument();
    expect(within(summary).queryByText('Ремонт')).not.toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'Разбивка по машинам' });
    expect(within(breakdown).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(breakdown).getByText('Hyundai Solaris')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Отчёт по ремонту' })).not.toBeInTheDocument();
  });

  it('toggles Отчёт по ремонту on and renders both financial summary and detailed per-car maintenance items', async () => {
    const updated = makeReport({
      includeFinancial: true,
      includeMaintenance: true,
      maintenanceCost: 5000,
      maintenanceCount: 2,
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
          maintenanceItems: [
            {
              id: 11,
              performedAt: '2026-11-24',
              title: 'Замена масла и фильтров',
              mileage: 142500,
              totalCost: 3500,
            },
            {
              id: 12,
              performedAt: '2026-11-26',
              title: 'Балансировка колёс',
              mileage: 142800,
              totalCost: 1500,
            },
          ],
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
      textTelegram: '**Еженедельный отчёт**\nРемонт: 5 000 ₽',
      textPlain: 'Еженедельный отчёт\nРемонт: 5 000 ₽',
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('type=weekly');
    expect(url).toContain('date=2026-11-25');
    expect(url).toContain('includeFinancial=true');
    expect(url).toContain('includeMaintenance=true');

    const financialCheckbox = screen.getByRole('checkbox', { name: 'Финансовый отчёт' }) as HTMLInputElement;
    const maintenanceCheckbox = screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }) as HTMLInputElement;
    expect(financialCheckbox.disabled).toBe(false);
    expect(maintenanceCheckbox.disabled).toBe(false);

    const summary = screen.getByRole('region', { name: 'Сводка отчёта' });
    expect(within(summary).getByText('Ремонт')).toBeInTheDocument();
    expect(within(summary).getByText('5 000 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('20 600 ₽')).toBeInTheDocument();

    const breakdown = screen.getByRole('region', { name: 'Разбивка по машинам' });
    expect(within(breakdown).getByRole('columnheader', { name: 'Ремонт' })).toBeInTheDocument();

    const maintSection = screen.getByRole('region', { name: 'Отчёт по ремонту' });
    expect(within(maintSection).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(maintSection).queryByText('Hyundai Solaris')).not.toBeInTheDocument();
    expect(within(maintSection).getByText('Замена масла и фильтров')).toBeInTheDocument();
    expect(within(maintSection).getByText('24.11.2026')).toBeInTheDocument();
    expect(within(maintSection).getByText('142 500 км')).toBeInTheDocument();
    expect(within(maintSection).getByText('3 500 ₽')).toBeInTheDocument();
    expect(within(maintSection).getByText('Балансировка колёс')).toBeInTheDocument();
  });

  it('unchecks Финансовый отчёт when Отчёт по ремонту is active, hides financial sections, and disables last checkbox', async () => {
    const bothReport = makeReport({
      includeFinancial: true,
      includeMaintenance: true,
      maintenanceCost: 5000,
      maintenanceCount: 1,
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
          maintenanceItems: [
            {
              id: 11,
              performedAt: '2026-11-24',
              title: 'Замена колодок',
              mileage: 140000,
              totalCost: 5000,
            },
          ],
        },
      ],
    });
    const maintenanceOnlyReport = makeReport({
      includeFinancial: false,
      includeMaintenance: true,
      paidRental: 0,
      managerIncome: 0,
      maintenanceCost: 5000,
      maintenanceCount: 1,
      ownerPayout: 0,
      cars: bothReport.cars,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ report: bothReport }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ report: maintenanceOnlyReport }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Финансовый отчёт' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [url] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('includeFinancial=false');
    expect(url).toContain('includeMaintenance=true');

    expect(screen.queryByRole('region', { name: 'Сводка отчёта' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Разбивка по машинам' })).not.toBeInTheDocument();

    const maintSummary = screen.getByRole('region', { name: 'Сводка по ремонту' });
    expect(within(maintSummary).getByText('Итого на ремонт')).toBeInTheDocument();
    expect(within(maintSummary).getByText('5 000 ₽')).toBeInTheDocument();
    expect(within(maintSummary).getByText('Записей о ремонте')).toBeInTheDocument();
    expect(within(maintSummary).getByText('1')).toBeInTheDocument();

    const maintSection = screen.getByRole('region', { name: 'Отчёт по ремонту' });
    expect(within(maintSection).getByText('Замена колодок')).toBeInTheDocument();

    const maintenanceCheckbox = screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }) as HTMLInputElement;
    expect(maintenanceCheckbox.checked).toBe(true);
    expect(maintenanceCheckbox.disabled).toBe(true);
  });

  it('keeps both checkboxes available in monthly and yearly modes without forcing includeMaintenance', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url, 'http://localhost');
      const periodType = (parsed.searchParams.get('type') ?? 'weekly') as FleetReportDto['type'];
      const incFin = parsed.searchParams.get('includeFinancial') === 'true';
      const incMaint = parsed.searchParams.get('includeMaintenance') === 'true';
      return {
        ok: true,
        json: async () => ({
          report: makeReport({
            type: periodType,
            periodLabel:
              periodType === 'yearly'
                ? `${parsed.searchParams.get('year')} год`
                : periodType === 'monthly'
                  ? 'Ноябрь 2026'
                  : 'неделя с 23.11.2026 по 29.11.2026',
            includeFinancial: incFin,
            includeMaintenance: incMaint,
            maintenanceCount: 0,
            cars: [],
          }),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ежемесячный' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain('type=monthly');
    expect(fetchMock.mock.calls[0][0]).toContain('month=2026-11');
    expect(fetchMock.mock.calls[0][0]).toContain('includeFinancial=true');
    expect(fetchMock.mock.calls[0][0]).toContain('includeMaintenance=false');

    expect(screen.getByRole('checkbox', { name: 'Финансовый отчёт' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('includeMaintenance=true');
    expect(screen.getByText('За выбранный период записей о ремонте нет')).toBeInTheDocument();
  });

  it('switches to yearly mode, steps years, and displays Ежегодный отчёт title', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url, 'http://localhost');
      const year = parsed.searchParams.get('year') ?? '2026';
      return {
        ok: true,
        json: async () => ({
          report: makeReport({
            type: 'yearly',
            periodStart: `${year}-01-01`,
            periodEnd: `${year}-12-31`,
            periodLabel: `${year} год`,
          }),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ежегодный' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain('type=yearly');
    expect(fetchMock.mock.calls[0][0]).toContain('year=2026');

    expect(screen.getByLabelText('Год отчёта')).toHaveValue(2026);
    expect(screen.getByText('Ежегодный отчёт: 2026 год, Все машины')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий год' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('year=2025');
    expect(screen.getByLabelText('Год отчёта')).toHaveValue(2025);

    fireEvent.click(screen.getByRole('button', { name: 'Следующий год' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain('year=2026');
    expect(screen.getByLabelText('Год отчёта')).toHaveValue(2026);
  });

  it('filters by owner and by specific car using optgroup scope selector', async () => {
    const ownerReport = makeReport({
      ownerId: 5,
      ownerName: 'Сергей Волков',
      carId: null,
      carLabel: 'Все машины',
      ownerPayout: 16000,
    });
    const singleCarReport = makeReport({
      carId: 2,
      carLabel: 'Hyundai Solaris (В222ВВ77)',
      ownerId: null,
      ownerName: null,
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
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ report: ownerReport }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ report: singleCarReport }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReportsClient
        initialReport={makeReport()}
        cars={SAMPLE_CARS}
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    const select = screen.getByLabelText('Автомобиль или собственник');
    const optgroups = select.querySelectorAll('optgroup');
    expect(optgroups).toHaveLength(2);
    expect(optgroups[0]).toHaveAttribute('label', 'По собственнику');
    expect(optgroups[1]).toHaveAttribute('label', 'По автомобилю');

    fireEvent.change(select, { target: { value: 'owner:5' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain('ownerId=5');
    expect(fetchMock.mock.calls[0][0]).not.toContain('carId=');
    expect(
      screen.getByText('Еженедельный отчёт: неделя с 23.11.2026 по 29.11.2026, Собственник: Сергей Волков'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Разбивка по машинам' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'car:2' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('carId=2');
    expect(fetchMock.mock.calls[1][0]).not.toContain('ownerId=');
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-01"
        initialYear="2026"
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
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
          owners={SAMPLE_OWNERS}
          initialDate="2026-11-25"
          initialMonth="2026-11"
          initialYear="2026"
        />
      </StrictMode>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears loading and stale error when date, month, or year input is cleared mid-flight or after error', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);

      if (signals.length === 1 || signals.length === 3 || signals.length === 5) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }

      if (signals.length === 6) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Ошибка года' }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          report: makeReport({
            type: url.includes('type=yearly')
              ? 'yearly'
              : url.includes('type=monthly')
                ? 'monthly'
                : 'weekly',
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    // 1) Weekly in-flight -> clear date -> recover via stepper
    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Дата недели'), { target: { value: '' } });
    expect(signals[0]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('date=2026-11-18');
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    // 2) Monthly in-flight -> clear month -> recover via stepper
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

    // 3) Yearly in-flight -> clear year -> stepper triggers error -> clear year clears stale error
    fireEvent.click(screen.getByRole('button', { name: 'Ежегодный' }));
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Год отчёта'), { target: { value: '' } });
    expect(signals[4]?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий год' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ошибка года');

    fireEvent.change(screen.getByLabelText('Год отчёта'), { target: { value: '' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
        owners={SAMPLE_OWNERS}
        initialDate="2026-11-25"
        initialMonth="2026-11"
        initialYear="2026"
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Отчёт по ремонту' }));
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
