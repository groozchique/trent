import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionUser } from '@/lib/auth/session';
import type { CarDetailDto } from '@/lib/validation';

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

import ManageCarPage from '@/app/cars/[id]/manage/page';
import { CarManageClient } from '@/components/CarManageClient';

const SAMPLE_CAR: CarDetailDto = {
  id: 7,
  plate: 'А123ВС 777',
  brand: 'Kia',
  model: 'Rio',
  status: 'in_rent',
  mileage: 142500,
  unpaidFinesCount: 1,
  fines: [
    {
      id: 11,
      carId: 7,
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
    renterName: 'Иванов Алексей Сергеевич',
    rateAmount: 2400,
    periodicity: 'daily',
    startDate: '2026-11-01',
    active: true,
  },
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
      notes: null,
      parts: [],
    },
  ],
};

describe('ManageCarPage server RBAC guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    getCurrentUserMock.mockReset();
    getCarDetailMock.mockReset();
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
  });

  it('redirects viewer user to /', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 2, username: 'viewer', role: 'viewer' });

    await expect(
      ManageCarPage({ params: Promise.resolve({ id: '7' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(getCarDetailMock).not.toHaveBeenCalled();
  });

  it('calls notFound for invalid car id or missing car', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });

    await expect(
      ManageCarPage({ params: Promise.resolve({ id: 'abc' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(getCarDetailMock).not.toHaveBeenCalled();

    getCarDetailMock.mockResolvedValue(null);
    await expect(
      ManageCarPage({ params: Promise.resolve({ id: '999' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(2);
    expect(getCarDetailMock).toHaveBeenCalledWith({}, 999);
  });

  it('renders CarManageClient for admin when car exists', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });
    getCarDetailMock.mockResolvedValue(SAMPLE_CAR);

    const element = await ManageCarPage({ params: Promise.resolve({ id: '7' }) });
    render(element);

    expect(screen.getByRole('heading', { name: /Kia Rio/i })).toBeInTheDocument();
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /На дашборд/i })).toHaveAttribute('href', '/');
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

  it('switches across all 4 accessible tabs and renders corresponding forms', () => {
    render(<CarManageClient car={SAMPLE_CAR} />);

    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent('Общая информация');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Гос. номер')).toHaveValue('А123ВС 777');

    fireEvent.click(within(tablist).getByRole('tab', { name: 'ТО и ремонт' }));
    expect(within(tablist).getByRole('tab', { name: 'ТО и ремонт' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Название работ')).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Аренда' }));
    expect(within(tablist).getByRole('tab', { name: 'Аренда' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Арендатор')).toHaveValue('Иванов Алексей Сергеевич');

    fireEvent.click(within(tablist).getByRole('tab', { name: 'Штрафы' }));
    expect(within(tablist).getByRole('tab', { name: 'Штрафы' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Синхронизировать с API' })).toBeInTheDocument();
    expect(screen.getByLabelText('Номер постановления')).toBeInTheDocument();

    // Keyboard navigation wraps around cleanly
    const finesTab = within(tablist).getByRole('tab', { name: 'Штрафы' });
    fireEvent.keyDown(finesTab, { key: 'ArrowRight' });
    expect(within(tablist).getByRole('tab', { name: 'Общая информация' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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

    render(<CarManageClient car={SAMPLE_CAR} />);

    // Empty plate validation in Общая информация prevents fetch
    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите гос. номер');
    expect(fetchMock).not.toHaveBeenCalled();

    // Switch to ТО и ремонт, add then remove a part row, and submit with zero parts
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

  it('rejects cleared part quantity with inline validation error instead of silently defaulting to 1', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CarManageClient car={SAMPLE_CAR} />);

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

    render(<CarManageClient car={SAMPLE_CAR} />);

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
        }),
      });
    });

    expect(await screen.findByText('К555МН 777')).toBeInTheDocument();
    expect(screen.getByText('145 000 км')).toBeInTheDocument();

    // Inline two-step delete confirmation
    fireEvent.click(screen.getByRole('button', { name: 'Удалить автомобиль' }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const cancelBtn = screen.getByRole('button', { name: 'Отмена' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('button', { name: 'Подтвердить удаление' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить автомобиль' }));
    const confirmDeleteBtn = screen.getByRole('button', { name: 'Подтвердить удаление' });
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

    render(<CarManageClient car={SAMPLE_CAR} />);

    fireEvent.click(screen.getByRole('tab', { name: 'ТО и ремонт' }));

    fireEvent.change(screen.getByLabelText('Название работ'), {
      target: { value: 'Замена тормозных колодок' },
    });
    fireEvent.change(screen.getByLabelText('Дата проведения'), {
      target: { value: '2026-11-21' },
    });
    fireEvent.change(screen.getByLabelText(/Пробег/i), {
      target: { value: '143200' },
    });

    // Add 2 dynamic parts
    const addPartButton = screen.getByRole('button', { name: 'Добавить запчасть' });
    fireEvent.click(addPartButton);
    fireEvent.click(addPartButton);

    const partNames = screen.getAllByLabelText(/^Запчасть$/i);
    const partSkus = screen.getAllByLabelText(/^Артикул$/i);
    const partQuantities = screen.getAllByLabelText(/^Кол-во$/i);
    const partUnitPrices = screen.getAllByLabelText(/^Цена, ₽$/i);

    expect(partNames).toHaveLength(2);

    // Part 1: qty 2 * 2400 = 4800, blank SKU
    fireEvent.change(partNames[0], { target: { value: 'Колодки передние' } });
    fireEvent.change(partSkus[0], { target: { value: '' } });
    fireEvent.change(partQuantities[0], { target: { value: '2' } });
    fireEvent.change(partUnitPrices[0], { target: { value: '2400' } });

    // Part 2: qty 1 * 1400 = 1400, blank SKU
    fireEvent.change(partNames[1], { target: { value: 'Смазка направляющих' } });
    fireEvent.change(partSkus[1], { target: { value: '' } });
    fireEvent.change(partQuantities[1], { target: { value: '1' } });
    fireEvent.change(partUnitPrices[1], { target: { value: '1400' } });

    // Labor cost: 2500 -> total = 4800 + 1400 + 2500 = 8700
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

  it('submits «Аренда» via PUT /api/cars/[id]/rental with { renterName, rateAmount, periodicity, startDate }', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/rental' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            rental: {
              id: 3,
              carId: 7,
              renterName: 'Петров Дмитрий Иванович',
              rateAmount: 14000,
              periodicity: 'weekly',
              startDate: '2026-11-25',
              active: true,
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

    render(<CarManageClient car={{ ...SAMPLE_CAR, rental: null }} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Аренда' }));

    fireEvent.change(screen.getByLabelText('Арендатор'), {
      target: { value: 'Петров Дмитрий Иванович' },
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
      expect(parsedBody).toEqual(
        expect.objectContaining({
          renterName: 'Петров Дмитрий Иванович',
          rateAmount: 14000,
          periodicity: 'weekly',
          startDate: '2026-11-25',
        }),
      );
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/Настройки аренды сохранены/i);
  });

  it('syncs fines via POST /api/cars/[id]/fines/sync and creates manual fine via POST /api/cars/[id]/fines', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars/7/fines/sync' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ inserted: 2, updated: 1 }),
        });
      }
      if (url === '/api/cars/7/fines' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            fine: {
              id: 99,
              carId: 7,
              resolutionNumber: '18810177261199990001',
              violatedAt: '2026-11-20T10:15',
              amount: 1500,
              discountAmount: 750,
              discountDeadline: '2026-12-10',
              paymentDeadline: '2027-01-20',
              description: 'Пересечение стоп-линии',
              status: 'unpaid',
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

    render(<CarManageClient car={SAMPLE_CAR} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Штрафы' }));

    // Fine list stacks on narrow screens and allows long resolution numbers to wrap cleanly
    const resolutionEl = screen.getByText('18810177261100001001');
    expect(resolutionEl).toHaveClass('break-all');
    expect(resolutionEl.closest('li')).toHaveClass('flex-col', 'sm:flex-row');

    const fineForm = screen.getByRole('form', { name: 'Добавить штраф вручную' });
    fireEvent.click(within(fineForm).getByRole('button', { name: 'Добавить штраф' }));
    expect(within(fineForm).getByRole('alert')).toHaveTextContent('Укажите номер постановления');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать с API' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/fines/sync', { method: 'POST' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/добавлено 2, обновлено 1/i);
    expect(within(fineForm).queryByRole('status')).not.toBeInTheDocument();

    fireEvent.change(within(fineForm).getByLabelText('Номер постановления'), {
      target: { value: '18810177261199990001' },
    });
    fireEvent.change(within(fineForm).getByLabelText('Дата и время нарушения'), {
      target: { value: '2026-11-20T10:15' },
    });
    fireEvent.change(within(fineForm).getByLabelText(/Сумма штрафа/i), {
      target: { value: '1500' },
    });
    fireEvent.change(within(fineForm).getByLabelText(/Сумма со скидкой/i), {
      target: { value: '750' },
    });
    fireEvent.change(within(fineForm).getByLabelText(/Срок действия скидки/i), {
      target: { value: '2026-12-10' },
    });
    fireEvent.change(within(fineForm).getByLabelText(/Крайний срок оплаты/i), {
      target: { value: '2027-01-20' },
    });
    fireEvent.change(within(fineForm).getByLabelText('Описание нарушения'), {
      target: { value: 'Пересечение стоп-линии' },
    });
    fireEvent.change(within(fineForm).getByLabelText('Статус штрафа'), {
      target: { value: 'unpaid' },
    });

    fireEvent.click(within(fineForm).getByRole('button', { name: 'Добавить штраф' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/7/fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolutionNumber: '18810177261199990001',
          violatedAt: '2026-11-20T10:15',
          amount: 1500,
          discountAmount: 750,
          discountDeadline: '2026-12-10',
          paymentDeadline: '2027-01-20',
          description: 'Пересечение стоп-линии',
          status: 'unpaid',
        }),
      });
    });

    expect(await within(fineForm).findByRole('status')).toHaveTextContent(/Штраф добавлен/i);
  });
});
