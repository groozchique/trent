import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionUser } from '@/lib/auth/session';
import type { DriverDetailDto, DriverSummaryDto } from '@/lib/validation';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const redirectMock = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getCurrentUserMock = vi.fn<() => Promise<SessionUser | null>>();
const listDriverSummariesMock = vi.fn<() => Promise<DriverSummaryDto[]>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  redirect: (url: string) => redirectMock(url),
}));

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock('@/lib/drivers', () => ({
  listDriverSummaries: () => listDriverSummariesMock(),
}));

import DriversPage from '@/app/drivers/page';
import { DriversClient } from '@/components/DriversClient';
import { DriverDetailModal } from '@/components/DriverDetailModal';

const SAMPLE_DRIVERS: DriverSummaryDto[] = [
  {
    id: 1,
    fullName: 'Иванов Алексей Сергеевич',
    phone: '+7 916 111-22-33',
    notes: 'Основной водитель Kia Rio',
    archived: false,
    createdAt: '2026-10-01T09:00:00Z',
    activeCars: [
      {
        carId: 10,
        plate: 'А123ВС 777',
        brand: 'Kia',
        model: 'Rio',
        rentalId: 100,
        rateAmount: 2400,
        periodicity: 'weekly',
        startDate: '2026-10-28',
      },
    ],
    rentDebt30d: 4800,
    unpaidFinesSum: 2250,
    unpaidFinesCount: 2,
  },
  {
    id: 2,
    fullName: 'Смирнов Дмитрий Павлович',
    phone: '+7 925 222-33-44',
    notes: null,
    archived: false,
    createdAt: '2026-10-05T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 1500,
    unpaidFinesCount: 1,
  },
  {
    id: 3,
    fullName: 'Петров Олег Николаевич',
    phone: null,
    notes: null,
    archived: false,
    createdAt: '2026-10-10T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 0,
    unpaidFinesCount: 0,
  },
  {
    id: 4,
    fullName: 'Архивов Сергей Петрович',
    phone: '+7 903 444-55-66',
    notes: 'Сдал машину в октябре',
    archived: true,
    createdAt: '2026-09-10T09:00:00Z',
    activeCars: [],
    rentDebt30d: 0,
    unpaidFinesSum: 0,
    unpaidFinesCount: 0,
  },
];

const SAMPLE_DRIVER_DETAIL: DriverDetailDto = {
  ...SAMPLE_DRIVERS[0],
  rentalsHistory: [
    {
      id: 100,
      carId: 10,
      driverId: 1,
      renterName: 'Иванов Алексей Сергеевич',
      driverPhone: '+7 916 111-22-33',
      rateAmount: 2400,
      periodicity: 'weekly',
      startDate: '2026-10-28',
      endDate: null,
      active: true,
      managerCommissionPercent: 0,
      rentDebt30d: 4800,
      carPlate: 'А123ВС 777',
      carBrand: 'Kia',
      carModel: 'Rio',
      timeline: [
        {
          dueDate: '2026-11-04',
          amount: 2400,
          status: 'paid',
          paidAt: '2026-11-04T10:00:00Z',
        },
        {
          dueDate: '2026-11-11',
          amount: 2400,
          status: 'overdue',
          paidAt: null,
        },
        {
          dueDate: '2026-11-18',
          amount: 2400,
          status: 'overdue',
          paidAt: null,
        },
      ],
    },
    {
      id: 95,
      carId: 11,
      driverId: 1,
      renterName: 'Иванов Алексей Сергеевич',
      driverPhone: '+7 916 111-22-33',
      rateAmount: 2100,
      periodicity: 'daily',
      startDate: '2026-09-01',
      endDate: '2026-10-20',
      active: false,
      managerCommissionPercent: 0,
      rentDebt30d: 0,
      carPlate: 'В456ОР 777',
      carBrand: 'Hyundai',
      carModel: 'Solaris',
      timeline: [],
    },
  ],
  fines: [
    {
      id: 201,
      carId: 10,
      driverId: 1,
      driverName: 'Иванов Алексей Сергеевич',
      carPlate: 'А123ВС 777',
      resolutionNumber: '18810177261100001001',
      violatedAt: '2026-11-18T14:20:00+03:00',
      amount: 1500,
      discountAmount: 1125,
      discountDeadline: '2026-12-08',
      paymentDeadline: '2027-01-17',
      description: 'Превышение скорости на 20–40 км/ч',
      status: 'unpaid',
    },
    {
      id: 202,
      carId: 10,
      driverId: 1,
      driverName: 'Иванов Алексей Сергеевич',
      carPlate: 'А123ВС 777',
      resolutionNumber: '18810177261100001002',
      violatedAt: '2026-10-12T08:05:00+03:00',
      amount: 500,
      discountAmount: null,
      discountDeadline: null,
      paymentDeadline: '2026-12-11',
      description: 'Нарушение правил применения ремней',
      status: 'paid',
    },
  ],
};

describe('DriversPage SSR guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
    listDriverSummariesMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects unauthenticated guest to /login', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(DriversPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(listDriverSummariesMock).not.toHaveBeenCalled();
  });

  it('renders DriversClient for viewer without admin controls', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 2, username: 'viewer', role: 'viewer' });
    listDriverSummariesMock.mockResolvedValue(SAMPLE_DRIVERS);

    const element = await DriversPage();
    render(element);

    expect(listDriverSummariesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Водители' })).toBeInTheDocument();
    expect(screen.getByText('Иванов Алексей Сергеевич')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить водителя' })).not.toBeInTheDocument();
  });

  it('renders DriversClient for admin with «Добавить водителя» button', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });
    listDriverSummariesMock.mockResolvedValue(SAMPLE_DRIVERS);

    const element = await DriversPage();
    render(element);

    expect(screen.getByRole('button', { name: 'Добавить водителя' })).toBeInTheDocument();
  });
});

describe('DriversClient', () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('filters drivers by tabs (Активные, С долгами, Архив) and searches by fullName or phone', () => {
    render(<DriversClient initialDrivers={SAMPLE_DRIVERS} userRole="viewer" />);

    const activeBtn = screen.getByRole('button', { name: 'Активные' });
    const debtorsBtn = screen.getByRole('button', { name: 'С долгами' });
    const archiveBtn = screen.getByRole('button', { name: 'Архив' });

    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Иванов Алексей Сергеевич')).toBeInTheDocument();
    expect(screen.getByText('Смирнов Дмитрий Павлович')).toBeInTheDocument();
    expect(screen.getByText('Петров Олег Николаевич')).toBeInTheDocument();
    expect(screen.queryByText('Архивов Сергей Петрович')).not.toBeInTheDocument();

    // Driver card details: active car, Без машины, rent debt; fines row hidden
    const ivanovCard = screen.getByRole('button', { name: /Иванов Алексей Сергеевич/ });
    expect(within(ivanovCard).getByText('+7 916 111-22-33')).toBeInTheDocument();
    expect(within(ivanovCard).getByText(/А123ВС 777/)).toBeInTheDocument();
    expect(within(ivanovCard).getByText(/Kia Rio/)).toBeInTheDocument();
    expect(within(ivanovCard).getByText('4 800 ₽')).toBeInTheDocument();
    expect(within(ivanovCard).queryByText('Штрафы')).not.toBeInTheDocument();
    expect(within(ivanovCard).queryByText('2 250 ₽ (2 шт.)')).not.toBeInTheDocument();

    const petrovCard = screen.getByRole('button', { name: /Петров Олег Николаевич/ });
    expect(within(petrovCard).getByText('Без машины')).toBeInTheDocument();
    expect(within(petrovCard).getAllByText('0 ₽')).toHaveLength(1);
    expect(within(petrovCard).queryByText('Штрафы')).not.toBeInTheDocument();

    // Filter: С долгами excludes drivers with only unpaid fines and zero rent debt
    fireEvent.click(debtorsBtn);
    expect(debtorsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Иванов Алексей Сергеевич')).toBeInTheDocument();
    expect(screen.queryByText('Смирнов Дмитрий Павлович')).not.toBeInTheDocument();
    expect(screen.queryByText('Петров Олег Николаевич')).not.toBeInTheDocument();
    expect(screen.queryByText('Архивов Сергей Петрович')).not.toBeInTheDocument();

    // Filter: Архив
    fireEvent.click(archiveBtn);
    expect(archiveBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Архивов Сергей Петрович')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Алексей Сергеевич')).not.toBeInTheDocument();

    // Return to Активные and test search
    fireEvent.click(activeBtn);
    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: '925' } });
    expect(screen.getByText('Смирнов Дмитрий Павлович')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Алексей Сергеевич')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'петров' } });
    expect(screen.getByText('Петров Олег Николаевич')).toBeInTheDocument();
    expect(screen.queryByText('Смирнов Дмитрий Павлович')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'несуществующий' } });
    expect(screen.getByText('По этим фильтрам водителей нет')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByText('Иванов Алексей Сергеевич')).toBeInTheDocument();
    expect(screen.getByText('Смирнов Дмитрий Павлович')).toBeInTheDocument();
    expect(screen.getByText('Петров Олег Николаевич')).toBeInTheDocument();
  });

  it('includes archived drivers with rent debt in «С долгами» with «В архиве» badge and excludes fine-only debtors', () => {
    const driversWithArchivedDebtors: DriverSummaryDto[] = [
      ...SAMPLE_DRIVERS,
      {
        id: 5,
        fullName: 'Долгов Виктор Аркадьевич',
        phone: '+7 905 555-66-77',
        notes: null,
        archived: true,
        createdAt: '2026-09-12T09:00:00Z',
        activeCars: [],
        rentDebt30d: 3200,
        unpaidFinesSum: 0,
        unpaidFinesCount: 0,
      },
      {
        id: 6,
        fullName: 'Штрафов Роман Игоревич',
        phone: null,
        notes: null,
        archived: true,
        createdAt: '2026-09-14T09:00:00Z',
        activeCars: [],
        rentDebt30d: 0,
        unpaidFinesSum: 1000,
        unpaidFinesCount: 1,
      },
    ];

    render(<DriversClient initialDrivers={driversWithArchivedDebtors} userRole="viewer" />);

    // Default «Активные» excludes all archived drivers
    expect(screen.queryByText('Долгов Виктор Аркадьевич')).not.toBeInTheDocument();
    expect(screen.queryByText('Штрафов Роман Игоревич')).not.toBeInTheDocument();

    // «С долгами» includes archived drivers with rent debt and excludes fine-only debtors when SHOW_FINES is false
    fireEvent.click(screen.getByRole('button', { name: 'С долгами' }));
    const rentDebtorCard = screen.getByRole('button', { name: /Долгов Виктор Аркадьевич/ });
    expect(within(rentDebtorCard).getByText('В архиве')).toBeInTheDocument();
    expect(within(rentDebtorCard).getByText('3 200 ₽')).toBeInTheDocument();

    expect(screen.queryByText('Штрафов Роман Игоревич')).not.toBeInTheDocument();
    expect(screen.queryByText('Архивов Сергей Петрович')).not.toBeInTheDocument();
    expect(screen.queryByText('Петров Олег Николаевич')).not.toBeInTheDocument();

    // «Архив» still shows only archived drivers
    fireEvent.click(screen.getByRole('button', { name: 'Архив' }));
    expect(screen.getByText('Архивов Сергей Петрович')).toBeInTheDocument();
    expect(screen.getByText('Долгов Виктор Аркадьевич')).toBeInTheDocument();
    expect(screen.getByText('Штрафов Роман Игоревич')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Алексей Сергеевич')).not.toBeInTheDocument();
  });

  it('hides admin create control for viewer and allows admin to create a driver via POST /api/drivers', async () => {
    const { rerender } = render(<DriversClient initialDrivers={SAMPLE_DRIVERS} userRole="viewer" />);
    expect(screen.queryByRole('button', { name: 'Добавить водителя' })).not.toBeInTheDocument();

    const createdDriver: DriverSummaryDto = {
      id: 9,
      fullName: 'Козлов Андрей Викторович',
      phone: '+7 999 888-77-66',
      notes: 'Выход на линию с понедельника',
      archived: false,
      createdAt: '2026-11-22T00:00:00Z',
      activeCars: [],
      rentDebt30d: 0,
      unpaidFinesSum: 0,
      unpaidFinesCount: 0,
    };

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ driver: createdDriver }),
    });
    vi.stubGlobal('fetch', fetchMock);

    rerender(<DriversClient initialDrivers={SAMPLE_DRIVERS} userRole="admin" />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить водителя' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Новый водитель' })).toBeInTheDocument();

    // Zod validation rejects empty fullName without fetch
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Укажите ФИО водителя');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('ФИО'), {
      target: { value: '  Козлов Андрей Викторович  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Телефон'), {
      target: { value: ' +7 999 888-77-66 ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Заметка'), {
      target: { value: ' Выход на линию с понедельника ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Козлов Андрей Викторович',
          phone: '+7 999 888-77-66',
          notes: 'Выход на линию с понедельника',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Козлов Андрей Викторович')).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('opens DriverDetailModal lazily on card click and syncs archive/update changes to the list', async () => {
    const archivedDetail: DriverDetailDto = {
      ...SAMPLE_DRIVER_DETAIL,
      id: 3,
      fullName: 'Петров Олег Николаевич',
      phone: null,
      notes: null,
      archived: false,
      activeCars: [],
      rentDebt30d: 0,
      unpaidFinesSum: 0,
      unpaidFinesCount: 0,
      rentalsHistory: [],
      fines: [],
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/drivers/3' && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ driver: archivedDetail }),
        });
      }
      if (url === '/api/drivers/3' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ driver: { ...archivedDetail, archived: true } }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DriversClient initialDrivers={SAMPLE_DRIVERS} userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: /Петров Олег Николаевич/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Архивировать' })).toBeInTheDocument();
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Архивировать' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Вернуть из архива' })).toBeInTheDocument();
    });

    // Close modal and verify driver moved from Активные to Архив
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Петров Олег Николаевич')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Архив' }));
    expect(screen.getByText('Петров Олег Николаевич')).toBeInTheDocument();
  });
});

describe('DriverDetailModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches driver detail lazily, recovers from error on retry, and hides admin actions for viewer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Ошибка загрузки профиля' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ driver: SAMPLE_DRIVER_DETAIL }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DriverDetailModal
        driverId={1}
        userRole="viewer"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Загрузка карточки водителя')).toBeInTheDocument();

    expect(await screen.findByRole('alert')).toHaveTextContent('Ошибка загрузки профиля');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => {
      expect(screen.getByText('28.10.2026', { exact: false })).toBeInTheDocument();
    });

    // Rental history visible; fines section and header badge hidden when SHOW_FINES is false
    expect(screen.getByText('Kia Rio')).toBeInTheDocument();
    expect(screen.getByText('Hyundai Solaris')).toBeInTheDocument();
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Штрафы водителя' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Штрафы \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Штрафы:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Превышение скорости на 20–40 км/ч')).not.toBeInTheDocument();
    expect(screen.queryByText('Нарушение правил применения ремней')).not.toBeInTheDocument();

    // Viewer cannot edit or archive
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Архивировать' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ФИО')).not.toBeInTheDocument();
  });

  it('validates and updates driver details and shows inline 409 when archiving with active rental', async () => {
    const onUpdated = vi.fn();
    const updatedDetail: DriverDetailDto = {
      ...SAMPLE_DRIVER_DETAIL,
      fullName: 'Иванов Алексей Обновлённый',
      phone: '+7 916 000-11-22',
      notes: 'Обновлённая заметка',
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/drivers/1' && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ driver: SAMPLE_DRIVER_DETAIL }),
        });
      }
      if (url === '/api/drivers/1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        if (body.archived === true) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              error: 'Нельзя архивировать водителя с активной арендой',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ driver: updatedDetail }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DriverDetailModal
        driverId={1}
        userRole="admin"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const fullNameInput = await screen.findByLabelText('ФИО');
    const phoneInput = screen.getByLabelText('Телефон');
    const notesInput = screen.getByLabelText('Заметка');

    expect(fullNameInput).toHaveValue('Иванов Алексей Сергеевич');
    expect(phoneInput).toHaveValue('+7 916 111-22-33');
    expect(notesInput).toHaveValue('Основной водитель Kia Rio');

    // Empty fullName fails inline without PATCH
    fireEvent.change(fullNameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите ФИО водителя');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Valid edit saves via PATCH
    fireEvent.change(fullNameInput, { target: { value: 'Иванов Алексей Обновлённый' } });
    fireEvent.change(phoneInput, { target: { value: '+7 916 000-11-22' } });
    fireEvent.change(notesInput, { target: { value: 'Обновлённая заметка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/drivers/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Иванов Алексей Обновлённый',
          phone: '+7 916 000-11-22',
          notes: 'Обновлённая заметка',
        }),
      });
      expect(onUpdated).toHaveBeenCalledWith(updatedDetail);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Archive fails with 409 inline
    fireEvent.click(screen.getByRole('button', { name: 'Архивировать' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Нельзя архивировать водителя с активной арендой',
      );
    });
  });

  it('renders active rental without comma before «по настоящее время» and omits fabricated endDate when null', async () => {
    const driverWithNullEndDate: DriverDetailDto = {
      ...SAMPLE_DRIVER_DETAIL,
      rentalsHistory: [
        SAMPLE_DRIVER_DETAIL.rentalsHistory[0],
        {
          ...SAMPLE_DRIVER_DETAIL.rentalsHistory[1],
          id: 96,
          startDate: '2026-08-15',
          endDate: null,
          active: false,
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ driver: driverWithNullEndDate }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DriverDetailModal
        driverId={1}
        userRole="viewer"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('с 28.10.2026 по настоящее время')).toBeInTheDocument();
    expect(screen.queryByText(/28\.10\.2026,\s*по настоящее время/)).not.toBeInTheDocument();

    expect(screen.getByText('с 15.08.2026')).toBeInTheDocument();
    expect(screen.queryByText('с 15.08.2026 по 15.08.2026')).not.toBeInTheDocument();
  });

  it('opens RentalTimelineModal from История аренды for a driver with no active car and lets admin toggle payment', async () => {
    const unassignedDebtorDetail: DriverDetailDto = {
      ...SAMPLE_DRIVER_DETAIL,
      activeCars: [],
      rentDebt30d: 2500,
      rentalsHistory: [
        {
          id: 98,
          carId: 12,
          driverId: 1,
          renterName: 'Иванов Алексей Сергеевич',
          driverPhone: '+7 916 111-22-33',
          rateAmount: 2500,
          periodicity: 'weekly',
          startDate: '2026-11-10',
          endDate: '2026-11-18',
          active: false,
          managerCommissionPercent: 0,
          rentDebt30d: 2500,
          carPlate: 'Е303ЕЕ 777',
          carBrand: 'Skoda',
          carModel: 'Octavia',
          timeline: [
            {
              dueDate: '2026-11-10',
              amount: 2500,
              status: 'overdue',
              paidAt: null,
            },
          ],
        },
      ],
    };

    const settledDetail: DriverDetailDto = {
      ...unassignedDebtorDetail,
      rentDebt30d: 0,
      rentalsHistory: [
        {
          ...unassignedDebtorDetail.rentalsHistory[0],
          rentDebt30d: 0,
          timeline: [
            {
              dueDate: '2026-11-10',
              amount: 2500,
              status: 'paid',
              paidAt: '2026-11-22T09:00:00Z',
            },
          ],
        },
      ],
    };

    let settled = false;
    const onUpdated = vi.fn();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/drivers/1' && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ driver: settled ? settledDetail : unassignedDebtorDetail }),
        });
      }
      if (url === '/api/cars/12/rental/payments' && init?.method === 'POST') {
        settled = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            payment: {
              id: 77,
              rentalId: 98,
              dueDate: '2026-11-10',
              amount: 2500,
              paidAt: '2026-11-22T09:00:00Z',
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <DriverDetailModal
        driverId={1}
        userRole="viewer"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const historyHeading = await screen.findByRole('heading', { name: 'История аренды (1)' });
    const historySection = historyHeading.closest('section')!;
    fireEvent.click(within(historySection).getByRole('button', { name: 'Таймлайн' }));

    const dialogsAfterOpen = screen.getAllByRole('dialog');
    const timelineDialog = dialogsAfterOpen[dialogsAfterOpen.length - 1];
    expect(within(timelineDialog).getByText('Таймлайн оплаты аренды')).toBeInTheDocument();
    expect(within(timelineDialog).getByText('Skoda Octavia')).toBeInTheDocument();
    expect(within(timelineDialog).getByText('Е303ЕЕ 777')).toBeInTheDocument();
    expect(within(timelineDialog).getByText('Завершена')).toBeInTheDocument();
    expect(within(timelineDialog).getByText('Просрочен')).toBeInTheDocument();
    expect(
      within(timelineDialog).queryByRole('button', { name: 'Отметить оплату' }),
    ).not.toBeInTheDocument();

    // Admin sees pay button and settles closed rental debt using explicit rentalId
    rerender(
      <DriverDetailModal
        driverId={1}
        userRole="admin"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const payBtn = within(timelineDialog).getByRole('button', { name: 'Отметить оплату' });
    fireEvent.click(payBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/12/rental/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId: 98,
          dueDate: '2026-11-10',
          paid: true,
        }),
      });
    });

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(settledDetail);
    });
    expect(within(timelineDialog).getByText('Оплачен')).toBeInTheDocument();
  });
});
