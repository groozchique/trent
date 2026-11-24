import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CarSummaryDto, FleetDashboardSummary } from '@/lib/validation';
import { CarCompactCard } from '@/components/CarCompactCard';
import { DashboardClient } from '@/components/DashboardClient';
import { AddCarModal } from '@/components/AddCarModal';

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

const SAMPLE_CARS: CarSummaryDto[] = [
  {
    id: 1,
    plate: 'А123ВС 777',
    brand: 'Kia',
    model: 'Rio',
    status: 'in_rent',
    mileage: 142500,
    stsNumber: null,
    nextServiceMileage: null,
    nextServiceDate: null,
    ownerId: null,
    ownerName: null,
    unpaidFinesCount: 2,
    unpaidFinesSum: 2250,
    rentDebt30d: 0,
    activeDriverId: null,
    activeDriverName: null,
    deadlineStatus: 'ok',
    urgentDeadlinesCount: 0,
  },
  {
    id: 2,
    plate: 'В456ОР 777',
    brand: 'Hyundai',
    model: 'Solaris',
    status: 'in_repair',
    mileage: 98400,
    stsNumber: null,
    nextServiceMileage: null,
    nextServiceDate: null,
    ownerId: null,
    ownerName: null,
    unpaidFinesCount: 0,
    unpaidFinesSum: 0,
    rentDebt30d: 0,
    activeDriverId: null,
    activeDriverName: null,
    deadlineStatus: 'ok',
    urgentDeadlinesCount: 0,
  },
  {
    id: 3,
    plate: 'Е789КХ 799',
    brand: 'Skoda',
    model: 'Octavia',
    status: 'available',
    mileage: 34100,
    stsNumber: null,
    nextServiceMileage: null,
    nextServiceDate: null,
    ownerId: null,
    ownerName: null,
    unpaidFinesCount: 1,
    unpaidFinesSum: 1500,
    rentDebt30d: 0,
    activeDriverId: null,
    activeDriverName: null,
    deadlineStatus: 'ok',
    urgentDeadlinesCount: 0,
  },
];

describe('CarCompactCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders plate, brand icon, model, Russian status, formatted mileage, and hides unpaid fines when SHOW_FINES is false', () => {
    const onSelect = vi.fn();
    render(<CarCompactCard car={SAMPLE_CARS[0]} onSelect={onSelect} />);

    const cardButton = screen.getByRole('button');
    expect(within(cardButton).getByText('А123ВС 777')).toBeInTheDocument();
    expect(within(cardButton).getByRole('img', { name: /Kia/i })).toHaveAttribute(
      'data-brand',
      'kia',
    );
    expect(within(cardButton).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(cardButton).getByText('В аренде')).toBeInTheDocument();
    expect(within(cardButton).getByText('142 500 км')).toBeInTheDocument();
    expect(within(cardButton).queryByText('Неоплаченные штрафы')).not.toBeInTheDocument();
    expect(within(cardButton).queryByText('2')).not.toBeInTheDocument();

    fireEvent.click(cardButton);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('shows «Нет арендатора» and green «Всё в норме» deadline badge when activeDriverName is null and deadlineStatus is ok', () => {
    render(<CarCompactCard car={SAMPLE_CARS[0]} onSelect={vi.fn()} />);

    expect(screen.getByText('Нет арендатора')).toBeInTheDocument();
    expect(screen.getByText('Сроки')).toBeInTheDocument();
    const okBadge = screen.getByText('Всё в норме');
    expect(okBadge).toHaveAttribute('data-deadline-status', 'ok');
    expect(okBadge.style.color).toBe('var(--status-rent-text)');
    expect(okBadge.style.backgroundColor).toBe('var(--status-rent-bg)');
    expect(okBadge.style.borderColor).toBe('var(--status-rent-border)');
  });

  it('shows activeDriverName and urgent deadline badge without leaking stsNumber on compact card', () => {
    const warningCar: CarSummaryDto = {
      ...SAMPLE_CARS[0],
      stsNumber: '99 01 112233',
      activeDriverId: 5,
      activeDriverName: 'Иванов Алексей Сергеевич',
      deadlineStatus: 'warning',
      urgentDeadlinesCount: 2,
    };

    const { rerender } = render(<CarCompactCard car={warningCar} onSelect={vi.fn()} />);
    expect(screen.getByText('Иванов Алексей Сергеевич')).toBeInTheDocument();
    const warningPill = screen.getByText('Истекают сроки: 2');
    expect(warningPill).toHaveAttribute('data-deadline-status', 'warning');
    expect(screen.queryByText(/99 01 112233/)).not.toBeInTheDocument();

    rerender(
      <CarCompactCard
        car={{
          ...warningCar,
          deadlineStatus: 'expired',
          urgentDeadlinesCount: 1,
        }}
        onSelect={vi.fn()}
      />,
    );
    const expiredPill = screen.getByText('Просрочено сроков: 1');
    expect(expiredPill).toHaveAttribute('data-deadline-status', 'expired');
  });
});

describe('DashboardClient', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('filters cards by status pills and search query', () => {
    render(<DashboardClient initialCars={SAMPLE_CARS} userRole="viewer" />);

    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.getByText('Е789КХ 799')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'На ремонте' }));
    expect(screen.queryByText('А123ВС 777')).not.toBeInTheDocument();
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.queryByText('Е789КХ 799')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.getByText('Е789КХ 799')).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox');
    expect(searchInput.className).toContain('appearance-none');
    fireEvent.change(searchInput, { target: { value: 'e789' } });
    // Cyrillic E vs Latin e: test exact Cyrillic query for plate and Latin for model
    expect(screen.queryByText('Е789КХ 799')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'е789' } });
    expect(screen.getByText('Е789КХ 799')).toBeInTheDocument();
    expect(screen.queryByText('А123ВС 777')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'rio' } });
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.queryByText('Е789КХ 799')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'несуществующий' } });
    expect(screen.getByText('По этим фильтрам машин нет')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.getByText('Е789КХ 799')).toBeInTheDocument();
  });

  it('shows «Добавить машину» button for admin and hides it for viewer', () => {
    const { rerender } = render(<DashboardClient initialCars={SAMPLE_CARS} userRole="viewer" />);
    expect(screen.queryByRole('button', { name: 'Добавить машину' })).not.toBeInTheDocument();

    rerender(<DashboardClient initialCars={SAMPLE_CARS} userRole="admin" />);
    expect(screen.getByRole('button', { name: 'Добавить машину' })).toBeInTheDocument();
  });

  it('tracks selectedCarId when a compact car card is clicked', () => {
    render(<DashboardClient initialCars={SAMPLE_CARS} userRole="viewer" />);

    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('data-selected-car-id');

    fireEvent.click(screen.getByRole('button', { name: /В456ОР 777/ }));
    expect(main).toHaveAttribute('data-selected-car-id', '2');
  });

  it('opens AddCarModal, creates a car via POST /api/cars, refreshes cars, and closes', async () => {
    const createdCar: CarSummaryDto = {
      id: 4,
      plate: 'М321ТН 777',
      brand: 'Geely',
      model: 'Coolray',
      status: 'available',
      mileage: 12000,
      stsNumber: null,
      nextServiceMileage: null,
      nextServiceDate: null,
      ownerId: null,
      ownerName: null,
      unpaidFinesCount: 0,
      unpaidFinesSum: 0,
      rentDebt30d: 0,
      activeDriverId: null,
      activeDriverName: null,
      deadlineStatus: 'ok',
      urgentDeadlinesCount: 0,
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/cars' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ car: createdCar }),
        });
      }
      if (url === '/api/cars') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ cars: [...SAMPLE_CARS, createdCar] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DashboardClient initialCars={SAMPLE_CARS} userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Добавить машину' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Гос. номер'), {
      target: { value: 'М321ТН 777' },
    });
    fireEvent.change(within(dialog).getByLabelText('Марка'), {
      target: { value: 'Geely' },
    });
    fireEvent.change(within(dialog).getByLabelText('Модель'), {
      target: { value: 'Coolray' },
    });
    fireEvent.change(within(dialog).getByLabelText('Статус'), {
      target: { value: 'available' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Пробег/i), {
      target: { value: '12000' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: 'М321ТН 777',
          brand: 'Geely',
          model: 'Coolray',
          status: 'available',
          mileage: 12000,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('М321ТН 777')).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('renders 4 KPI cards in exact order when totalRentDebt30d > 0 and filters urgent deadlines with «Сроки»', () => {
    const carsWithDeadlines: CarSummaryDto[] = [
      {
        ...SAMPLE_CARS[0],
        rentDebt30d: 4800,
        activeDriverId: 1,
        activeDriverName: 'Иванов Алексей Сергеевич',
        deadlineStatus: 'ok',
        urgentDeadlinesCount: 0,
      },
      {
        ...SAMPLE_CARS[1],
        activeDriverId: 2,
        activeDriverName: 'Смирнов Дмитрий Павлович',
        deadlineStatus: 'warning',
        urgentDeadlinesCount: 2,
      },
      {
        ...SAMPLE_CARS[2],
        deadlineStatus: 'expired',
        urgentDeadlinesCount: 1,
      },
    ];
    const summary: FleetDashboardSummary = {
      totalRentDebt30d: 4800,
      totalUnpaidFinesSum: 3750,
      totalUnpaidFinesCount: 3,
      paidRental30d: 32000,
      managerIncome30d: 3200,
      paidRentalMonth: 18000,
      managerIncomeMonth: 1800,
      maintenanceCost30d: 9600,
      netIncome30d: 19200,
      urgentDeadlineCarsCount: 2,
    };

    render(
      <DashboardClient
        initialCars={carsWithDeadlines}
        initialSummary={summary}
        userRole="viewer"
      />,
    );

    const kpiRegion = screen.getByRole('region', { name: 'Финансовая сводка' });
    expect(
      Array.from(kpiRegion.children).map((card) => card.firstElementChild?.textContent?.trim()),
    ).toEqual([
      'Аренда за месяц',
      'Доход менеджера за месяц',
      'Итог за 30 дней',
      'Долг по аренде',
    ]);
    expect(within(kpiRegion).getByText('18 000 ₽')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('Оплачено с 1-го числа')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('1 800 ₽')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('Комиссия с оплаченной аренды')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('+19 200 ₽')).toBeInTheDocument();
    expect(
      within(kpiRegion).getByText('Аренда 32 000 ₽, менеджер 3 200 ₽, ремонт 9 600 ₽'),
    ).toBeInTheDocument();
    expect(within(kpiRegion).getByText('4 800 ₽')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('Просрочено за 30 дн.')).toBeInTheDocument();

    // Old KPI cards are removed
    expect(within(kpiRegion).queryByText('Неоплаченные штрафы')).not.toBeInTheDocument();
    expect(within(kpiRegion).queryByText('Сроки документов и ТО')).not.toBeInTheDocument();

    // Toggle urgent deadlines via filter button (with quiet tabular count)
    const filtersRegion = screen.getByRole('region', { name: 'Фильтры и поиск' });
    const urgentFilterBtn = within(filtersRegion).getByRole('button', { name: /Сроки/i });
    expect(screen.getByRole('button', { name: /^Сроки/i })).toBe(urgentFilterBtn);
    expect(urgentFilterBtn).toHaveTextContent('Сроки (2)');
    fireEvent.click(urgentFilterBtn);
    expect(urgentFilterBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('А123ВС 777')).not.toBeInTheDocument();
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.getByText('Е789КХ 799')).toBeInTheDocument();

    fireEvent.click(urgentFilterBtn);
    expect(urgentFilterBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();

    // Search by driver name
    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'смирнов' } });
    expect(screen.getByText('В456ОР 777')).toBeInTheDocument();
    expect(screen.queryByText('А123ВС 777')).not.toBeInTheDocument();
    expect(screen.queryByText('Е789КХ 799')).not.toBeInTheDocument();
  });

  it('always renders all 4 KPI cards with green «0 ₽» and «Долгов нет» when totalRentDebt30d === 0, and formats negative 30d net income', () => {
    render(
      <DashboardClient
        initialCars={SAMPLE_CARS}
        initialSummary={{
          totalRentDebt30d: 0,
          totalUnpaidFinesSum: 0,
          totalUnpaidFinesCount: 0,
          paidRental30d: 4000,
          managerIncome30d: 500,
          paidRentalMonth: 4000,
          managerIncomeMonth: 500,
          maintenanceCost30d: 7500,
          netIncome30d: -4000,
          urgentDeadlineCarsCount: 0,
        }}
        userRole="viewer"
      />,
    );

    const kpiRegion = screen.getByRole('region', { name: 'Финансовая сводка' });
    expect(
      Array.from(kpiRegion.children).map((card) => card.firstElementChild?.textContent?.trim()),
    ).toEqual([
      'Аренда за месяц',
      'Доход менеджера за месяц',
      'Итог за 30 дней',
      'Долг по аренде',
    ]);
    const zeroDebtValue = within(kpiRegion).getByText('0 ₽');
    expect(zeroDebtValue.style.color).toBe('var(--status-rent-text)');
    expect(within(kpiRegion).getByText('Долгов нет')).toBeInTheDocument();
    expect(within(kpiRegion).getByText('-4 000 ₽')).toBeInTheDocument();
    expect(
      within(kpiRegion).getByText('Аренда 4 000 ₽, менеджер 500 ₽, ремонт 7 500 ₽'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сроки' })).toHaveTextContent('Сроки');
  });

  it('filters cars by ownerName via search query', () => {
    const carsWithOwners: CarSummaryDto[] = [
      { ...SAMPLE_CARS[0], ownerId: 10, ownerName: 'Сергей Волков' },
      { ...SAMPLE_CARS[1], ownerId: 11, ownerName: 'Анна Петрова' },
      { ...SAMPLE_CARS[2], ownerId: null, ownerName: null },
    ];

    render(<DashboardClient initialCars={carsWithOwners} userRole="admin" />);

    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toHaveAttribute(
      'placeholder',
      'Номер, марка, модель, водитель или собственник',
    );
    expect(searchInput).toHaveAttribute(
      'aria-label',
      'Поиск по номеру, марке, модели, водителю или собственнику',
    );

    fireEvent.change(searchInput, { target: { value: 'волков' } });
    expect(screen.getByText('А123ВС 777')).toBeInTheDocument();
    expect(screen.queryByText('В456ОР 777')).not.toBeInTheDocument();
    expect(screen.queryByText('Е789КХ 799')).not.toBeInTheDocument();
  });

  it('renders empty state copy per role when fleet is empty', () => {
    const { rerender } = render(<DashboardClient initialCars={[]} userRole="admin" />);

    expect(
      screen.getByText(
        'Нажмите «Добавить машину», чтобы добавить первую машину и вести аренду, документы и ТО.',
      ),
    ).toBeInTheDocument();

    rerender(<DashboardClient initialCars={[]} userRole="owner" />);
    expect(
      screen.getByText('К вашей учётной записи пока не привязаны автомобили.'),
    ).toBeInTheDocument();

    rerender(<DashboardClient initialCars={[]} userRole="viewer" />);
    expect(screen.getByText('Попросите администратора добавить машины.')).toBeInTheDocument();
  });
});

describe('AddCarModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed, validates negative mileage, closes on Escape/backdrop, and shows server errors inline', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Автомобиль с таким гос. номером уже существует' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <AddCarModal open={false} onClose={onClose} onCreated={onCreated} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<AddCarModal open={true} onClose={onClose} onCreated={onCreated} />);

    // Submitting empty form validates inline without calling fetch
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите гос. номер');
    expect(fetchMock).not.toHaveBeenCalled();

    // Negative mileage fails validation inline without calling fetch
    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: 'А123ВС 777' } });
    fireEvent.change(screen.getByLabelText('Марка'), { target: { value: 'Kia' } });
    fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'Rio' } });
    fireEvent.change(screen.getByLabelText(/Пробег/i), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Пробег не может быть отрицательным');
    expect(fetchMock).not.toHaveBeenCalled();

    // Fix mileage and verify server 409 error is displayed inline
    fireEvent.change(screen.getByLabelText(/Пробег/i), { target: { value: '142500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Автомобиль с таким гос. номером уже существует',
      );
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByTestId('add-car-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('submits optional Номер СТС when provided and validates max length 32', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ car: { ...SAMPLE_CARS[0], id: 9, stsNumber: '99 01 123456' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AddCarModal open={true} onClose={onClose} onCreated={onCreated} />);

    const stsInput = screen.getByLabelText('Номер СТС');
    expect(stsInput).toHaveAttribute('placeholder', '99 01 123456');

    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: 'К999МН 777' } });
    fireEvent.change(screen.getByLabelText('Марка'), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'Camry' } });
    fireEvent.change(screen.getByLabelText(/Пробег/i), { target: { value: '5000' } });
    fireEvent.change(stsInput, { target: { value: 'X'.repeat(33) } });

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/32/);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(stsInput, { target: { value: '  99 01 123456  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: 'К999МН 777',
          brand: 'Toyota',
          model: 'Camry',
          status: 'available',
          mileage: 5000,
          stsNumber: '99 01 123456',
        }),
      });
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
