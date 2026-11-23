import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionUser } from '@/lib/auth/session';
import type { CarDetailDto, DriverSummaryDto } from '@/lib/validation';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const redirectMock = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const notFoundMock = vi.fn((): never => {
  throw new Error('NEXT_NOT_FOUND');
});
const getCurrentUserMock = vi.fn<() => Promise<SessionUser | null>>();
const getCarDetailMock = vi.fn<(db: unknown, carId: number) => Promise<CarDetailDto | null>>();
const listDriverSummariesMock = vi.fn<() => Promise<DriverSummaryDto[]>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock('@/lib/cars', () => ({
  getCarDetail: (database: unknown, carId: number) => getCarDetailMock(database, carId),
}));

vi.mock('@/lib/drivers', () => ({
  listDriverSummaries: () => listDriverSummariesMock(),
}));

import ManageCarPage from '@/app/cars/[id]/manage/page';
import { CarManageClient } from '@/components/CarManageClient';

const SAMPLE_DRIVERS: DriverSummaryDto[] = [
  {
    id: 1,
    fullName: 'Иванов Алексей Сергеевич',
    phone: '+7 916 111-22-33',
    notes: null,
    archived: false,
    createdAt: '2026-10-01T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 750,
    unpaidFinesCount: 1,
  },
  {
    id: 2,
    fullName: 'Петров Дмитрий Иванович',
    phone: '+7 916 222-33-44',
    notes: null,
    archived: false,
    createdAt: '2026-10-05T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 0,
    unpaidFinesCount: 0,
  },
  {
    id: 3,
    fullName: 'Архивов Сергей Петрович',
    phone: null,
    notes: null,
    archived: true,
    createdAt: '2026-09-10T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 0,
    unpaidFinesCount: 0,
  },
];

const SAMPLE_CAR: CarDetailDto = {
  id: 7,
  plate: 'А123ВС 777',
  brand: 'Kia',
  model: 'Rio',
  status: 'in_rent',
  mileage: 142500,
  stsNumber: null,
  nextServiceMileage: null,
  nextServiceDate: null,
  unpaidFinesCount: 1,
  unpaidFinesSum: 750,
  rentDebt30d: 0,
  activeDriverId: 1,
  activeDriverName: 'Иванов Алексей Сергеевич',
  deadlineStatus: 'ok',
  urgentDeadlinesCount: 0,
  documents: [],
  deadlines: {
    status: 'ok',
    urgentDeadlinesCount: 0,
    expiredCount: 0,
    warningCount: 0,
    serviceMileage: null,
    serviceDate: null,
    documents: [],
  },
  fines: [
    {
      id: 11,
      carId: 7,
      driverId: 1,
      driverName: 'Иванов Алексей Сергеевич',
      resolutionNumber: '18810177261100001001',
      violatedAt: '2026-11-18T14:20:00+03:00',
      amount: 750,
      discountAmount: 562,
      discountDeadline: '2026-12-08',
      paymentDeadline: '2027-01-17',
      description: 'Превышение скорости на 20–40 км/ч',
      status: 'unpaid',
    },
  ],
  rental: {
    id: 3,
    carId: 7,
    driverId: 1,
    renterName: 'Иванов Алексей Сергеевич',
    driverPhone: '+7 916 111-22-33',
    rateAmount: 2400,
    periodicity: 'daily',
    startDate: '2026-11-01',
    endDate: null,
    active: true,
    managerCommissionPercent: 0,
  },
  rentalHistory: [],
  timeline: [],
  maintenance: [
    {
      id: 21,
      carId: 7,
      title: 'ТО-140: замена масла',
      performedAt: '2026-11-03',
      mileage: 140000,
      laborCost: 2000,
      totalCost: 5600,
      notes: 'Плановое ТО',
      parts: [
        {
          id: 31,
          recordId: 21,
          name: 'Масло 5W-30',
          sku: 'OIL-530',
          quantity: 4,
          unitPrice: 900,
        },
      ],
    },
  ],
};

describe('ManageCarPage server RBAC guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    getCurrentUserMock.mockReset();
    getCarDetailMock.mockReset();
    listDriverSummariesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects unauthenticated user to /login', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(
      ManageCarPage({ params: Promise.resolve({ id: '7' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(getCarDetailMock).not.toHaveBeenCalled();
    expect(listDriverSummariesMock).not.toHaveBeenCalled();
  });

  it('redirects viewer user to /', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 2, username: 'viewer', role: 'viewer' });

    await expect(
      ManageCarPage({ params: Promise.resolve({ id: '7' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(getCarDetailMock).not.toHaveBeenCalled();
    expect(listDriverSummariesMock).not.toHaveBeenCalled();
  });

  it('calls notFound for invalid car id or missing car', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });

    await expect(
      ManageCarPage({ params: Promise.resolve({ id: 'abc' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(getCarDetailMock).not.toHaveBeenCalled();
    expect(listDriverSummariesMock).not.toHaveBeenCalled();

    getCarDetailMock.mockResolvedValue(null);
    await expect(
      ManageCarPage({ params: Promise.resolve({ id: '999' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(2);
    expect(getCarDetailMock).toHaveBeenCalledWith({}, 999);
    expect(listDriverSummariesMock).not.toHaveBeenCalled();
  });

  it('renders CarManageClient for admin when car exists and loads drivers', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });
    getCarDetailMock.mockResolvedValue(SAMPLE_CAR);
    listDriverSummariesMock.mockResolvedValue(SAMPLE_DRIVERS);

    const element = await ManageCarPage({ params: Promise.resolve({ id: '7' }) });
    render(element);

    expect(listDriverSummariesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: /Kia Rio/i })).toBeInTheDocument();
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /На дашборд/i })).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));
    const driverSelect = screen.getByLabelText('Водитель') as HTMLSelectElement;
    expect(driverSelect.value).toBe('1');
    expect(within(driverSelect).getByRole('option', { name: 'Петров Дмитрий Иванович' })).toBeInTheDocument();
    expect(within(driverSelect).queryByRole('option', { name: 'Архивов Сергей Петрович' })).not.toBeInTheDocument();
  });
});

describe('CarManageClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('switches across all 4 visible accessible tabs and skips hidden «Штрафы» tab in keyboard navigation', () => {
    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent('Общая информация');
    expect(tabs[1]).toHaveTextContent('Документы и ТО');
    expect(tabs[2]).toHaveTextContent('ТО и ремонт');
    expect(tabs[3]).toHaveTextContent('Аренда');
    expect(within(tablist).queryByRole('tab', { name: 'Штрафы' })).not.toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'manage-panel-info');
    expect(tabs[1]).not.toHaveAttribute('aria-controls');
    expect(tabs[2]).not.toHaveAttribute('aria-controls');
    expect(tabs[3]).not.toHaveAttribute('aria-controls');
    expect(screen.getByLabelText('Гос. номер')).toHaveValue('А123ВС 777');
    expect(screen.getByLabelText('Номер СТС')).toHaveValue('');

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Документы и ТО' }));
    expect(within(tablist).getByRole('tab', { name: 'Документы и ТО' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Следующее ТО, км')).toBeInTheDocument();
    expect(screen.getByLabelText('Следующее ТО, дата')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'ОСАГО' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Техосмотр' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Лицензия такси' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'КАСКО' })).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'ТО и ремонт' }));
    expect(within(tablist).getByRole('tab', { name: 'ТО и ремонт' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Название работ')).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Аренда' }));
    const rentalTab = within(tablist).getByRole('tab', { name: 'Аренда' });
    expect(rentalTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Водитель')).toHaveValue('1');
    expect(screen.queryByLabelText('Аренда активна')).not.toBeInTheDocument();

    // ArrowRight on the last visible tab («Аренда») wraps to «Общая информация»
    fireEvent.keyDown(rentalTab, { key: 'ArrowRight' });
    const infoTab = within(tablist).getByRole('tab', { name: 'Общая информация' });
    expect(infoTab).toHaveAttribute('aria-selected', 'true');

    // ArrowLeft wraps back to «Аренда», Home jumps to first, End jumps to last
    fireEvent.keyDown(infoTab, { key: 'ArrowLeft' });
    expect(rentalTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(rentalTab, { key: 'Home' });
    expect(infoTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(infoTab, { key: 'End' });
    expect(rentalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('edits and clears stsNumber in «Общая информация» via PATCH /api/cars/[id]', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { stsNumber: string | null };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...SAMPLE_CAR,
              stsNumber: body.stsNumber,
            },
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: { ...SAMPLE_CAR, stsNumber: '99 01 123456' },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    const stsInput = screen.getByLabelText('Номер СТС');
    fireEvent.change(stsInput, { target: { value: '1'.repeat(33) } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Номер СТС не длиннее 32 символов');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(stsInput, { target: { value: ' 99 01 123456 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: 'А123ВС 777',
          brand: 'Kia',
          model: 'Rio',
          status: 'in_rent',
          mileage: 142500,
          stsNumber: '99 01 123456',
        }),
      });
    });

    expect(await screen.findByText('СТС: 99 01 123456')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Номер СТС'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/cars/7' && init?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(2);
      expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toEqual(
        expect.objectContaining({ stsNumber: null }),
      );
    });
  });

  it('saves documents and scheduled service via PUT /api/cars/[id]/documents and omits empty-date docs', async () => {
    const carWithDocs: CarDetailDto = {
      ...SAMPLE_CAR,
      nextServiceMileage: 145000,
      nextServiceDate: '2026-12-01',
      documents: [
        {
          id: 1,
          carId: 7,
          type: 'osago',
          expiresAt: '2026-11-30',
          policyNumber: 'ХХХ 0123456789',
          notes: 'Старый полис',
          status: 'warning',
          daysLeft: 9,
        },
        {
          id: 2,
          carId: 7,
          type: 'tech_inspection',
          expiresAt: '2026-11-10',
          policyNumber: 'ТО-77',
          notes: null,
          status: 'expired',
          daysLeft: -11,
        },
      ],
      deadlines: {
        status: 'expired',
        urgentDeadlinesCount: 3,
        expiredCount: 1,
        warningCount: 2,
        serviceMileage: { target: 145000, mileageLeft: 2500, status: 'ok' },
        serviceDate: { target: '2026-12-01', daysLeft: 10, status: 'warning' },
        documents: [
          { type: 'osago', label: 'ОСАГО', expiresAt: '2026-11-30', daysLeft: 9, status: 'warning' },
          { type: 'tech_inspection', label: 'Техосмотр', expiresAt: '2026-11-10', daysLeft: -11, status: 'expired' },
        ],
      },
    };

    const updatedDeadlines = {
      status: 'ok' as const,
      urgentDeadlinesCount: 0,
      expiredCount: 0,
      warningCount: 0,
      serviceMileage: { target: 150000, mileageLeft: 7500, status: 'ok' as const },
      serviceDate: { target: '2027-02-01', daysLeft: 72, status: 'ok' as const },
      documents: [
        { type: 'osago' as const, label: 'ОСАГО', expiresAt: '2027-11-30', daysLeft: 374, status: 'ok' as const },
        { type: 'kasko' as const, label: 'КАСКО', expiresAt: '2027-06-15', daysLeft: 206, status: 'ok' as const },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/documents' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            nextServiceMileage: 150000,
            nextServiceDate: '2027-02-01',
            documents: [
              {
                id: 1,
                carId: 7,
                type: 'osago',
                expiresAt: '2027-11-30',
                policyNumber: 'ХХХ 9998887776',
                notes: 'Продлён',
                status: 'ok',
                daysLeft: 374,
              },
              {
                id: 3,
                carId: 7,
                type: 'kasko',
                expiresAt: '2027-06-15',
                policyNumber: 'КАСКО-55',
                notes: null,
                status: 'ok',
                daysLeft: 206,
              },
            ],
            deadlines: updatedDeadlines,
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...carWithDocs,
              nextServiceMileage: 150000,
              nextServiceDate: '2027-02-01',
              deadlines: updatedDeadlines,
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={carWithDocs} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Документы и ТО' }));

    expect(screen.getByLabelText('Следующее ТО, км')).toHaveValue(145000);
    expect(screen.getByLabelText('Следующее ТО, дата')).toHaveValue('2026-12-01');

    const osagoGroup = screen.getByRole('group', { name: 'ОСАГО' });
    expect(within(osagoGroup).getByLabelText('Дата окончания')).toHaveValue('2026-11-30');
    expect(within(osagoGroup).getByLabelText('Номер документа')).toHaveValue('ХХХ 0123456789');
    expect(within(osagoGroup).getByText('Истекает')).toBeInTheDocument();

    const techGroup = screen.getByRole('group', { name: 'Техосмотр' });
    expect(within(techGroup).getByText('Просрочено')).toBeInTheDocument();

    // Update service schedule, update OSAGO, clear tech_inspection date to delete it, fill KASKO
    fireEvent.change(screen.getByLabelText('Следующее ТО, км'), { target: { value: '150000' } });
    fireEvent.change(screen.getByLabelText('Следующее ТО, дата'), {
      target: { value: '2027-02-01' },
    });

    fireEvent.change(within(osagoGroup).getByLabelText('Дата окончания'), {
      target: { value: '2027-11-30' },
    });
    fireEvent.change(within(osagoGroup).getByLabelText('Номер документа'), {
      target: { value: 'ХХХ 9998887776' },
    });
    fireEvent.change(within(osagoGroup).getByLabelText('Примечание'), {
      target: { value: 'Продлён' },
    });

    fireEvent.change(within(techGroup).getByLabelText('Дата окончания'), {
      target: { value: '' },
    });

    const kaskoGroup = screen.getByRole('group', { name: 'КАСКО' });
    fireEvent.change(within(kaskoGroup).getByLabelText('Дата окончания'), {
      target: { value: '2027-06-15' },
    });
    fireEvent.change(within(kaskoGroup).getByLabelText('Номер документа'), {
      target: { value: 'КАСКО-55' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить документы и сроки' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextServiceMileage: 150000,
          nextServiceDate: '2027-02-01',
          documents: [
            {
              type: 'osago',
              expiresAt: '2027-11-30',
              policyNumber: 'ХХХ 9998887776',
              notes: 'Продлён',
            },
            {
              type: 'kasko',
              expiresAt: '2027-06-15',
              policyNumber: 'КАСКО-55',
              notes: null,
            },
          ],
        }),
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Документы и сроки ТО сохранены/i);
  });

  it('supports removing part rows, zero-part maintenance submission, and inline validation errors', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/maintenance' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            record: {
              id: 56,
              carId: 7,
              title: 'Диагностика подвески',
              performedAt: '2026-11-21',
              mileage: 142500,
              laborCost: 1500,
              totalCost: 1500,
              notes: null,
              parts: [],
            },
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ car: SAMPLE_CAR }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите гос. номер');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запчасть' }));
    fireEvent.change(screen.getByLabelText(/^Цена, ₽$/i), { target: { value: '900' } });
    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('900 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить запчасть 1' }));
    expect(screen.queryByLabelText(/^Запчасть$/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('0 ₽');

    fireEvent.change(screen.getByLabelText('Название работ'), {
      target: { value: 'Диагностика подвески' },
    });
    fireEvent.change(screen.getByLabelText(/Стоимость работ/i), {
      target: { value: '1500' },
    });
    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('1 500 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить запись ТО' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Диагностика подвески',
          performedAt: '2026-11-21',
          mileage: 142500,
          laborCost: 1500,
          notes: null,
          parts: [],
        }),
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Запись ТО добавлена/i);
  });

  it('edits an existing maintenance record via PATCH and supports cancelling edit in «ТО и ремонт»', async () => {
    const editedRecord = {
      id: 21,
      carId: 7,
      title: 'ТО-140: масло и фильтр',
      performedAt: '2026-11-03',
      mileage: 140500,
      laborCost: 2500,
      totalCost: 6500,
      notes: 'Обновлено примечание',
      parts: [
        {
          id: 32,
          recordId: 21,
          name: 'Масло 5W-30',
          sku: 'OIL-530',
          quantity: 4,
          unitPrice: 1000,
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/maintenance/21' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ record: editedRecord }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: { ...SAMPLE_CAR, maintenance: [editedRecord] },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));

    const listSection = screen.getByRole('region', { name: 'Последние записи ТО' });
    fireEvent.click(within(listSection).getByRole('button', { name: 'Редактировать' }));

    expect(screen.getByLabelText('Название работ')).toHaveValue('ТО-140: замена масла');
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-11-03');
    expect(screen.getByLabelText(/Пробег/i)).toHaveValue(140000);
    expect(screen.getByLabelText(/Стоимость работ/i)).toHaveValue(2000);
    expect(screen.getByLabelText(/Примечание/i)).toHaveValue('Плановое ТО');
    expect(screen.getByLabelText(/^Запчасть$/i)).toHaveValue('Масло 5W-30');
    expect(screen.getByLabelText(/^Артикул$/i)).toHaveValue('OIL-530');
    expect(screen.getByLabelText(/^Кол-во$/i)).toHaveValue(4);
    expect(screen.getByLabelText(/^Цена, ₽$/i)).toHaveValue(900);
    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('5 600 ₽');
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeInTheDocument();

    // Cancel edit restores create mode
    fireEvent.click(screen.getByRole('button', { name: 'Отменить правку' }));
    expect(screen.getByLabelText('Название работ')).toHaveValue('');
    expect(screen.getByLabelText(/Пробег/i)).toHaveValue(142500);
    expect(screen.queryByLabelText(/^Запчасть$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить запись ТО' })).toBeInTheDocument();

    // Re-enter edit mode, modify fields, and submit PATCH
    fireEvent.click(within(listSection).getByRole('button', { name: 'Редактировать' }));
    fireEvent.change(screen.getByLabelText('Название работ'), {
      target: { value: 'ТО-140: масло и фильтр' },
    });
    fireEvent.change(screen.getByLabelText(/Пробег/i), { target: { value: '140500' } });
    fireEvent.change(screen.getByLabelText(/^Цена, ₽$/i), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/Стоимость работ/i), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText(/Примечание/i), {
      target: { value: 'Обновлено примечание' },
    });

    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('6 500 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/maintenance/21', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'ТО-140: масло и фильтр',
          performedAt: '2026-11-03',
          mileage: 140500,
          laborCost: 2500,
          notes: 'Обновлено примечание',
          parts: [
            {
              name: 'Масло 5W-30',
              sku: 'OIL-530',
              quantity: 4,
              unitPrice: 1000,
            },
          ],
        }),
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Запись ТО обновлена/i);
    expect(screen.getByText('ТО-140: масло и фильтр')).toBeInTheDocument();
    expect(screen.getByText('6 500 ₽')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить запись ТО' })).toBeInTheDocument();
  });

  it('rejects cleared part quantity with inline validation error instead of silently defaulting to 1', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));
    fireEvent.change(screen.getByLabelText('Название работ'), {
      target: { value: 'Замена фильтра' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запчасть' }));
    fireEvent.change(screen.getByLabelText(/^Запчасть$/i), {
      target: { value: 'Фильтр салона' },
    });
    fireEvent.change(screen.getByLabelText(/^Кол-во$/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^Цена, ₽$/i), { target: { value: '800' } });

    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('0 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить запись ТО' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Укажите количество');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updates general info via PATCH and deletes car via inline two-step confirmation without window.confirm', async () => {
    const updatedCar: CarDetailDto = {
      ...SAMPLE_CAR,
      plate: 'К555МН 777',
      mileage: 145000,
      status: 'available',
    };

    const confirmSpy = vi.spyOn(window, 'confirm');
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              id: 7,
              plate: 'К555МН 777',
              brand: 'Kia',
              model: 'Rio',
              status: 'available',
              mileage: 145000,
              stsNumber: null,
              unpaidFinesCount: 1,
            },
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ car: updatedCar }),
        });
      }
      if (url === '/api/cars/7' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: 'К555МН 777' } });
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'available' } });
    fireEvent.change(screen.getByLabelText(/Пробег/i), { target: { value: '145000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: 'К555МН 777',
          brand: 'Kia',
          model: 'Rio',
          status: 'available',
          mileage: 145000,
          stsNumber: null,
        }),
      });
    });

    expect(await screen.findByText('К555МН 777')).toBeInTheDocument();
    expect(screen.getByText('145 000 км')).toBeInTheDocument();

    expect(
      screen.getByText('Машина и все записи по аренде и ТО удалятся навсегда.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/штрафам/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить машину' }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const cancelBtn = screen.getByRole('button', { name: 'Отмена' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('button', { name: 'Да, удалить' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить машину' }));
    const confirmDeleteBtn = screen.getByRole('button', { name: 'Да, удалить' });
    expect(confirmDeleteBtn).toHaveAttribute(
      'style',
      expect.stringContaining('--status-danger-fg'),
    );
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7', { method: 'DELETE' });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/');
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it('adds 2 parts (optional blank SKU) + labor cost in «ТО и ремонт», live-computes total, and submits exact payload', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/maintenance' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            record: {
              id: 55,
              carId: 7,
              title: 'Замена тормозных колодок',
              performedAt: '2026-11-21',
              mileage: 143200,
              laborCost: 2500,
              totalCost: 8700,
              notes: 'Передняя ось',
              parts: [],
            },
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ car: { ...SAMPLE_CAR, mileage: 143200 } }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));

    fireEvent.change(screen.getByLabelText('Название работ'), {
      target: { value: 'Замена тормозных колодок' },
    });
    fireEvent.change(screen.getByLabelText('Дата'), {
      target: { value: '2026-11-21' },
    });
    fireEvent.change(screen.getByLabelText(/Пробег/i), {
      target: { value: '143200' },
    });

    const addPartButton = screen.getByRole('button', { name: 'Добавить запчасть' });
    fireEvent.click(addPartButton);
    fireEvent.click(addPartButton);

    const partNames = screen.getAllByLabelText(/^Запчасть$/i);
    const partSkus = screen.getAllByLabelText(/^Артикул$/i);
    const partQuantities = screen.getAllByLabelText(/^Кол-во$/i);
    const partUnitPrices = screen.getAllByLabelText(/^Цена, ₽$/i);

    expect(partNames).toHaveLength(2);

    fireEvent.change(partNames[0], { target: { value: 'Колодки передние' } });
    fireEvent.change(partSkus[0], { target: { value: '' } });
    fireEvent.change(partQuantities[0], { target: { value: '2' } });
    fireEvent.change(partUnitPrices[0], { target: { value: '2400' } });

    fireEvent.change(partNames[1], { target: { value: 'Смазка направляющих' } });
    fireEvent.change(partSkus[1], { target: { value: '' } });
    fireEvent.change(partQuantities[1], { target: { value: '1' } });
    fireEvent.change(partUnitPrices[1], { target: { value: '1400' } });

    fireEvent.change(screen.getByLabelText(/Стоимость работ/i), {
      target: { value: '2500' },
    });
    fireEvent.change(screen.getByLabelText(/Примечание/i), {
      target: { value: 'Передняя ось' },
    });

    expect(screen.getByTestId('maintenance-live-total')).toHaveTextContent('8 700 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить запись ТО' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Замена тормозных колодок',
          performedAt: '2026-11-21',
          mileage: 143200,
          laborCost: 2500,
          notes: 'Передняя ось',
          parts: [
            {
              name: 'Колодки передние',
              sku: null,
              quantity: 2,
              unitPrice: 2400,
            },
            {
              name: 'Смазка направляющих',
              sku: null,
              quantity: 1,
              unitPrice: 1400,
            },
          ],
        }),
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Запись ТО добавлена/i);
  });

  it('submits «Аренда» via PUT /api/cars/[id]/rental with driverId without removed active checkbox', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/rental' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: {
              id: 4,
              carId: 7,
              driverId: 2,
              renterName: 'Петров Дмитрий Иванович',
              driverPhone: '+7 916 222-33-44',
              rateAmount: 14000,
              periodicity: 'weekly',
              startDate: '2026-11-25',
              endDate: null,
              active: true,
            },
            carStatus: 'available',
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ car: SAMPLE_CAR }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CarManageClient
        car={{ ...SAMPLE_CAR, status: 'available', rental: null }}
        drivers={SAMPLE_DRIVERS}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));

    expect(screen.queryByLabelText('Аренда активна')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Водитель'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText(/Стоимость аренды/i), {
      target: { value: '14000' },
    });
    fireEvent.change(screen.getByLabelText(/Периодичность/i), {
      target: { value: 'weekly' },
    });
    fireEvent.change(screen.getByLabelText(/С какого числа платится/i), {
      target: { value: '2026-11-25' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));

    await waitFor(() => {
      const rentalCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/cars/7/rental' && init?.method === 'PUT',
      );
      expect(rentalCall).toBeDefined();
      const parsedBody = JSON.parse(String(rentalCall?.[1]?.body));
      expect(parsedBody).toEqual({
        driverId: 2,
        rateAmount: 14000,
        periodicity: 'weekly',
        startDate: '2026-11-25',
        active: true,
        managerCommissionPercent: 0,
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Настройки аренды сохранены/i);
  });

  it('creates an inline driver via POST /api/drivers, auto-selects it, and saves rental', async () => {
    const newDriver = {
      id: 10,
      fullName: 'Сидоров Максим Олегович',
      phone: '+7 903 555-66-77',
      notes: null,
      archived: false,
      createdAt: '2026-11-21T12:00:00Z',
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/drivers' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ driver: newDriver }),
        });
      }
      if (url === '/api/cars/7/rental' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: {
              id: 8,
              carId: 7,
              driverId: 10,
              renterName: 'Сидоров Максим Олегович',
              driverPhone: '+7 903 555-66-77',
              rateAmount: 2600,
              periodicity: 'daily',
              startDate: '2026-11-21',
              endDate: null,
              active: true,
            },
            carStatus: 'in_rent',
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...SAMPLE_CAR,
              status: 'in_rent',
              activeDriverId: 10,
              activeDriverName: 'Сидоров Максим Олегович',
              rental: {
                id: 8,
                carId: 7,
                driverId: 10,
                renterName: 'Сидоров Максим Олегович',
                driverPhone: '+7 903 555-66-77',
                rateAmount: 2600,
                periodicity: 'daily',
                startDate: '2026-11-21',
                endDate: null,
                active: true,
              },
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CarManageClient
        car={{ ...SAMPLE_CAR, status: 'available', rental: null }}
        drivers={SAMPLE_DRIVERS}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новый водитель' }));

    const miniForm = screen.getByRole('region', { name: 'Новый водитель' });
    fireEvent.click(within(miniForm).getByRole('button', { name: 'Сохранить водителя' }));
    expect(within(miniForm).getByRole('alert')).toHaveTextContent('Укажите ФИО водителя');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(miniForm).getByLabelText('ФИО'), {
      target: { value: 'Сидоров Максим Олегович' },
    });
    fireEvent.change(within(miniForm).getByLabelText('Телефон'), {
      target: { value: '+7 903 555-66-77' },
    });
    fireEvent.click(within(miniForm).getByRole('button', { name: 'Сохранить водителя' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Сидоров Максим Олегович',
          phone: '+7 903 555-66-77',
          notes: null,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Водитель')).toHaveValue('10');
    });

    fireEvent.change(screen.getByLabelText(/Стоимость аренды/i), { target: { value: '2600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/rental', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: 10,
          rateAmount: 2600,
          periodicity: 'daily',
          startDate: '2026-11-21',
          active: true,
          managerCommissionPercent: 0,
        }),
      });
    });

    expect(await screen.findByText('В аренде')).toBeInTheDocument();
  });

  it('ends active rental via POST /api/cars/[id]/rental/end, updates car status, and renders past rentalHistory', async () => {
    const carWithHistory: CarDetailDto = {
      ...SAMPLE_CAR,
      rentalHistory: [
        {
          id: 3,
          carId: 7,
          driverId: 1,
          renterName: 'Иванов Алексей Сергеевич',
          driverPhone: '+7 916 111-22-33',
          rateAmount: 2400,
          periodicity: 'daily',
          startDate: '2026-11-01',
          endDate: null,
          active: true,
          managerCommissionPercent: 0,
          rentDebt30d: 0,
        },
        {
          id: 2,
          carId: 7,
          driverId: 2,
          renterName: 'Петров Дмитрий Иванович',
          driverPhone: '+7 916 222-33-44',
          rateAmount: 14000,
          periodicity: 'weekly',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          active: false,
          managerCommissionPercent: 0,
          rentDebt30d: 14000,
        },
      ],
    };

    const closedRental = {
      id: 3,
      carId: 7,
      driverId: 1,
      renterName: 'Иванов Алексей Сергеевич',
      driverPhone: '+7 916 111-22-33',
      rateAmount: 2400,
      periodicity: 'daily' as const,
      startDate: '2026-11-01',
      endDate: '2026-11-21',
      active: false,
      managerCommissionPercent: 0,
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/rental/end' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: closedRental,
            carStatus: 'available',
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...carWithHistory,
              status: 'available',
              rental: null,
              activeDriverId: null,
              activeDriverName: null,
              rentalHistory: [
                { ...closedRental, rentDebt30d: 0 },
                carWithHistory.rentalHistory[1],
              ],
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={carWithHistory} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));

    const historySection = screen.getByRole('region', { name: 'История аренд' });
    expect(within(historySection).getByText('История аренд (1)')).toBeInTheDocument();
    expect(within(historySection).getByText('Петров Дмитрий Иванович')).toBeInTheDocument();
    expect(within(historySection).getByText('с 01.10.2026 по 31.10.2026')).toBeInTheDocument();
    expect(within(historySection).getByText('Долг: 14 000 ₽')).toBeInTheDocument();

    const endSection = screen.getByRole('region', { name: 'Завершение аренды' });
    expect(within(endSection).getByLabelText('Дата окончания')).toHaveValue('2026-11-21');

    fireEvent.click(within(endSection).getByRole('button', { name: 'Завершить аренду' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/rental/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate: '2026-11-21' }),
      });
    });

    expect(await screen.findByText('Не в аренде')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Завершение аренды' })).not.toBeInTheDocument();
    expect(within(historySection).getByText('История аренд (2)')).toBeInTheDocument();
    expect(within(historySection).getByText('с 01.11.2026 по 21.11.2026')).toBeInTheDocument();
  });

  it('renders «Процент менеджера, %» prefilled, validates 0..100 client-side, submits decimal 12.5, and shows commission in rental history when > 0', async () => {
    const carWithCommission: CarDetailDto = {
      ...SAMPLE_CAR,
      rental: {
        ...SAMPLE_CAR.rental!,
        managerCommissionPercent: 10,
      },
      rentalHistory: [
        {
          id: 2,
          carId: 7,
          driverId: 2,
          renterName: 'Петров Дмитрий Иванович',
          driverPhone: '+7 916 222-33-44',
          rateAmount: 14000,
          periodicity: 'weekly',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          active: false,
          managerCommissionPercent: 15,
          rentDebt30d: 0,
        },
        {
          id: 1,
          carId: 7,
          driverId: 1,
          renterName: 'Иванов Алексей Сергеевич',
          driverPhone: '+7 916 111-22-33',
          rateAmount: 2400,
          periodicity: 'daily',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          active: false,
          managerCommissionPercent: 0,
          rentDebt30d: 0,
        },
      ],
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/rental' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: {
              ...carWithCommission.rental!,
              managerCommissionPercent: 12.5,
            },
            carStatus: 'in_rent',
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...carWithCommission,
              rental: {
                ...carWithCommission.rental!,
                managerCommissionPercent: 12.5,
              },
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={carWithCommission} drivers={SAMPLE_DRIVERS} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));

    const commissionInput = screen.getByLabelText('Процент менеджера, %');
    expect(commissionInput).toHaveValue(10);

    const historySection = screen.getByRole('region', { name: 'История аренд' });
    expect(within(historySection).getByText('Менеджер: 15%')).toBeInTheDocument();
    expect(within(historySection).queryByText('Менеджер: 0%')).not.toBeInTheDocument();

    fireEvent.change(commissionInput, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Процент менеджера не может быть меньше 0');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(commissionInput, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Процент менеджера не может быть больше 100');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(commissionInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите процент менеджера');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(commissionInput, { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));

    await waitFor(() => {
      const rentalCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/cars/7/rental' && init?.method === 'PUT',
      );
      expect(rentalCall).toBeDefined();
      const parsedBody = JSON.parse(String(rentalCall?.[1]?.body));
      expect(parsedBody).toEqual({
        driverId: 1,
        rateAmount: 2400,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 12.5,
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Настройки аренды сохранены/i);
  });

  it('renders DELETE error inside delete confirmation section and syncs MaintenanceTab mileage when car prop updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Не удалось удалить автомобиль из базы' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить машину' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));

    const deleteSection = screen.getByRole('region', { name: 'Удаление машины' });
    expect(await within(deleteSection).findByRole('alert')).toHaveTextContent(
      'Не удалось удалить автомобиль из базы',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));
    expect(screen.getByLabelText(/Пробег/i)).toHaveValue(142500);

    rerender(<CarManageClient car={{ ...SAMPLE_CAR, mileage: 149000 }} drivers={SAMPLE_DRIVERS} />);
    expect(screen.getByLabelText(/Пробег/i)).toHaveValue(149000);
  });

  it('preserves in-progress RentalTab input across parent rerenders when rental fields are unchanged and syncs when changed', () => {
    const { rerender } = render(<CarManageClient car={SAMPLE_CAR} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));
    const driverSelect = screen.getByLabelText('Водитель');
    fireEvent.change(driverSelect, { target: { value: '2' } });
    expect(driverSelect).toHaveValue('2');

    // Fresh object identity with identical primitive rental values should NOT overwrite in-progress selection
    rerender(
      <CarManageClient
        car={{ ...SAMPLE_CAR, rental: { ...SAMPLE_CAR.rental! } }}
        drivers={[...SAMPLE_DRIVERS]}
      />,
    );
    expect(screen.getByLabelText('Водитель')).toHaveValue('2');

    // Genuine rental change from server should sync into the form
    rerender(
      <CarManageClient
        car={{
          ...SAMPLE_CAR,
          rental: { ...SAMPLE_CAR.rental!, driverId: 1, rateAmount: 2900 },
        }}
        drivers={SAMPLE_DRIVERS}
      />,
    );
    expect(screen.getByLabelText('Водитель')).toHaveValue('1');
    expect(screen.getByLabelText(/Стоимость аренды/i)).toHaveValue(2900);
  });

  it('validates negative service mileage, preserves archived assigned driver, and rejects endDate before startDate', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const carWithArchivedDriver: CarDetailDto = {
      ...SAMPLE_CAR,
      activeDriverId: 3,
      activeDriverName: 'Архивов Сергей Петрович',
      rental: {
        ...SAMPLE_CAR.rental!,
        driverId: 3,
        renterName: 'Архивов Сергей Петрович',
      },
    };

    render(<CarManageClient car={carWithArchivedDriver} drivers={SAMPLE_DRIVERS} />);

    // Documents validation
    fireEvent.click(screen.getByRole('tab', { name: 'Документы и ТО' }));
    fireEvent.change(screen.getByLabelText('Следующее ТО, км'), { target: { value: '-100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить документы и сроки' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Пробег следующего ТО не может быть отрицательным',
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // Rental archived assigned driver + endDate before startDate validation
    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));
    const driverSelect = screen.getByLabelText('Водитель');
    expect(driverSelect).toHaveValue('3');
    expect(
      within(driverSelect).getByRole('option', { name: 'Архивов Сергей Петрович (в архиве)' }),
    ).toBeInTheDocument();

    const endSection = screen.getByRole('region', { name: 'Завершение аренды' });
    fireEvent.change(within(endSection).getByLabelText('Дата окончания'), {
      target: { value: '2026-10-20' },
    });
    fireEvent.click(within(endSection).getByRole('button', { name: 'Завершить аренду' }));
    expect(within(endSection).getByRole('alert')).toHaveTextContent(
      'Дата окончания не может быть раньше даты начала аренды',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unset document policyNumber or notes without expiresAt and still deletes saved docs on cleared date', async () => {
    const carWithSavedOsago: CarDetailDto = {
      ...SAMPLE_CAR,
      documents: [
        {
          id: 1,
          carId: 7,
          type: 'osago',
          expiresAt: '2026-11-30',
          policyNumber: 'ХХХ 0123456789',
          notes: 'Старый полис',
          status: 'warning',
          daysLeft: 9,
        },
      ],
      deadlines: {
        ...SAMPLE_CAR.deadlines,
        documents: [
          { type: 'osago', label: 'ОСАГО', expiresAt: '2026-11-30', daysLeft: 9, status: 'warning' },
        ],
      },
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/documents' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            nextServiceMileage: null,
            nextServiceDate: null,
            documents: [],
            deadlines: SAMPLE_CAR.deadlines,
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ car: SAMPLE_CAR }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={carWithSavedOsago} drivers={SAMPLE_DRIVERS} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Документы и ТО' }));

    // (a1) Unset doc with policyNumber and empty expiresAt aborts PUT and preserves draft
    const kaskoGroup = screen.getByRole('group', { name: 'КАСКО' });
    const kaskoPolicyInput = within(kaskoGroup).getByLabelText('Номер документа');
    fireEvent.change(kaskoPolicyInput, { target: { value: 'КАСКО-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить документы и сроки' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Укажите дату окончания для документа «КАСКО»',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kaskoPolicyInput).toHaveValue('КАСКО-123');

    // (a2) Unset doc with notes and empty expiresAt also aborts PUT and preserves draft
    fireEvent.change(kaskoPolicyInput, { target: { value: '' } });
    const licenseGroup = screen.getByRole('group', { name: 'Лицензия такси' });
    const licenseNotesInput = within(licenseGroup).getByLabelText('Примечание');
    fireEvent.change(licenseNotesInput, { target: { value: 'Выдана в Москве' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить документы и сроки' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Укажите дату окончания для документа «Лицензия такси»',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(licenseNotesInput).toHaveValue('Выдана в Москве');

    // (b) Clearing expiresAt on already-saved doc deletes it via PUT even with policyNumber/notes still filled
    fireEvent.change(licenseNotesInput, { target: { value: '' } });
    const osagoGroup = screen.getByRole('group', { name: 'ОСАГО' });
    fireEvent.change(within(osagoGroup).getByLabelText('Дата окончания'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить документы и сроки' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextServiceMileage: null,
          nextServiceDate: null,
          documents: [],
        }),
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Документы и сроки ТО сохранены');
  });

  it('submits managerCommissionPercent=0 when reset to 0 and syncs input value on rerender', async () => {
    const carWithCommission: CarDetailDto = {
      ...SAMPLE_CAR,
      rental: {
        ...SAMPLE_CAR.rental!,
        managerCommissionPercent: 12,
      },
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/rental' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: {
              ...carWithCommission.rental!,
              managerCommissionPercent: 0,
            },
            carStatus: 'in_rent',
          }),
        });
      }
      if (url === '/api/cars/7' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            car: {
              ...carWithCommission,
              rental: {
                ...carWithCommission.rental!,
                managerCommissionPercent: 0,
              },
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<CarManageClient car={carWithCommission} drivers={SAMPLE_DRIVERS} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));

    const commissionInput = screen.getByLabelText('Процент менеджера, %');
    expect(commissionInput).toHaveValue(12);

    rerender(
      <CarManageClient
        car={{
          ...carWithCommission,
          rental: {
            ...carWithCommission.rental!,
            managerCommissionPercent: 18,
          },
        }}
        drivers={SAMPLE_DRIVERS}
      />,
    );
    expect(screen.getByLabelText('Процент менеджера, %')).toHaveValue(18);

    fireEvent.change(commissionInput, { target: { value: '' } });
    fireEvent.change(commissionInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аренду' }));

    await waitFor(() => {
      const rentalCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/cars/7/rental' && init?.method === 'PUT',
      );
      expect(rentalCall).toBeDefined();
      const parsedBody = JSON.parse(String(rentalCall?.[1]?.body));
      expect(parsedBody).toEqual({
        driverId: 1,
        rateAmount: 2400,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 0,
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Настройки аренды сохранены/i);
  });
});
