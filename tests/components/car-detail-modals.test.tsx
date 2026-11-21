import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CarDetailDto, FineDto, MaintenanceDto, RentalDto } from '@/lib/validation';
import type { TimelineItem } from '@/lib/rental/timeline';
import { CarDetailModal } from '@/components/CarDetailModal';
import { FinesListModal } from '@/components/FinesListModal';
import { FineDetailModal } from '@/components/FineDetailModal';
import { RentalTimelineModal } from '@/components/RentalTimelineModal';
import { ServiceHistoryModal } from '@/components/ServiceHistoryModal';
import { ServiceDetailModal } from '@/components/ServiceDetailModal';
import { DashboardClient } from '@/components/DashboardClient';

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

const SAMPLE_FINES: FineDto[] = [
  {
    id: 1,
    carId: 1,
    resolutionNumber: '18810177261100001001',
    violatedAt: '2026-11-18T14:20:00+03:00',
    amount: 750,
    discountAmount: 562,
    discountDeadline: '2026-12-08',
    paymentDeadline: '2027-01-17',
    description: 'Превышение скорости на 20–40 км/ч',
    status: 'unpaid',
  },
  {
    id: 2,
    carId: 1,
    resolutionNumber: '18810177261100001002',
    violatedAt: '2026-11-09T09:45:00+03:00',
    amount: 3000,
    discountAmount: 2250,
    discountDeadline: '2026-11-29',
    paymentDeadline: '2027-01-08',
    description: 'Движение по выделенной полосе',
    status: 'unpaid',
  },
  {
    id: 3,
    carId: 1,
    resolutionNumber: '18810177261100001003',
    violatedAt: '2026-10-24T19:10:00+03:00',
    amount: 1500,
    discountAmount: 1125,
    discountDeadline: '2026-11-17',
    paymentDeadline: '2026-12-23',
    description: 'Несоблюдение требований дорожных знаков',
    status: 'unpaid',
  },
  {
    id: 4,
    carId: 1,
    resolutionNumber: '18810177261100001004',
    violatedAt: '2026-10-12T08:05:00+03:00',
    amount: 500,
    discountAmount: null,
    discountDeadline: null,
    paymentDeadline: '2026-12-11',
    description: 'Нарушение правил применения ремней',
    status: 'paid',
  },
  {
    id: 5,
    carId: 1,
    resolutionNumber: '18810177261100001005',
    violatedAt: '2026-10-01T21:15:00+03:00',
    amount: 5000,
    discountAmount: null,
    discountDeadline: null,
    paymentDeadline: '2026-11-30',
    description: 'Нарушение правил остановки и стоянки',
    status: 'unpaid',
  },
];

const SAMPLE_RENTAL: RentalDto = {
  id: 10,
  carId: 1,
  renterName: 'Иванов Алексей Сергеевич',
  rateAmount: 2400,
  periodicity: 'weekly',
  startDate: '2026-10-28',
  active: true,
};

const SAMPLE_TIMELINE: TimelineItem[] = [
  {
    dueDate: '2026-11-04',
    amount: 2400,
    status: 'paid',
    paidAt: '2026-11-04T11:30:00Z',
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
  {
    dueDate: '2026-11-21',
    amount: 2400,
    status: 'upcoming',
    paidAt: null,
  },
];

const SAMPLE_MAINTENANCE: MaintenanceDto[] = [
  {
    id: 101,
    carId: 1,
    title: 'ТО-140: замена масла и фильтров',
    performedAt: '2026-11-03',
    mileage: 140000,
    laborCost: 2800,
    totalCost: 7400,
    notes: 'Плановое ТО, проверка ходовой без замечаний',
    parts: [
      {
        id: 1,
        recordId: 101,
        name: 'Масло моторное 5W-30 (4 л)',
        sku: 'OIL-5W30-4L',
        quantity: 1,
        unitPrice: 3600,
      },
      {
        id: 2,
        recordId: 101,
        name: 'Фильтр масляный',
        sku: '26300-35505',
        quantity: 1,
        unitPrice: 650,
      },
      {
        id: 3,
        recordId: 101,
        name: 'Расходники и очиститель',
        sku: null,
        quantity: 1,
        unitPrice: 350,
      },
    ],
  },
  {
    id: 102,
    carId: 1,
    title: 'Шиномонтаж сезонный',
    performedAt: '2026-10-15',
    mileage: 137200,
    laborCost: 2200,
    totalCost: 2200,
    notes: null,
    parts: [],
  },
];

const SAMPLE_CAR_DETAIL: CarDetailDto = {
  id: 1,
  plate: 'А123ВС 777',
  brand: 'Kia',
  model: 'Rio',
  status: 'in_rent',
  mileage: 142500,
  unpaidFinesCount: 4,
  fines: SAMPLE_FINES,
  rental: SAMPLE_RENTAL,
  timeline: SAMPLE_TIMELINE,
  maintenance: SAMPLE_MAINTENANCE,
};

function stubCarDetailFetch(car: CarDetailDto = SAMPLE_CAR_DETAIL) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/cars/${car.id}` && (!init?.method || init.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ car }),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CarDetailModal and nested modals', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
    refreshMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders only 3 fines inline out of 5 with «Посмотреть все (5)» and opens FinesListModal with all 5', async () => {
    stubCarDetailFetch();

    render(
      <CarDetailModal carId={1} userRole="viewer" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('А123ВС 777')).toBeInTheDocument();
    expect(within(dialog).getByText('Kia Rio')).toBeInTheDocument();
    expect(within(dialog).getByText('142 500 км')).toBeInTheDocument();

    // First 3 fines are visible inline
    expect(within(dialog).getByText('Превышение скорости на 20–40 км/ч')).toBeInTheDocument();
    expect(within(dialog).getByText('Движение по выделенной полосе')).toBeInTheDocument();
    expect(within(dialog).getByText('Несоблюдение требований дорожных знаков')).toBeInTheDocument();
    // 4th and 5th are not rendered inline
    expect(
      within(dialog).queryByText('Нарушение правил применения ремней'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText('Нарушение правил остановки и стоянки'),
    ).not.toBeInTheDocument();

    const viewAllBtn = within(dialog).getByRole('button', { name: 'Посмотреть все (5)' });
    fireEvent.click(viewAllBtn);

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    const listDialog = dialogs[1];
    expect(within(listDialog).getByText('Нарушение правил применения ремней')).toBeInTheDocument();
    expect(within(listDialog).getByText('Нарушение правил остановки и стоянки')).toBeInTheDocument();

    // Pressing Escape closes only the top nested modal, keeping CarDetailModal open
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('opens FineDetailModal for expired discount showing exact resolution, violatedAt, full amount, paymentDeadline, and «Скидка истекла» with no negative days', async () => {
    stubCarDetailFetch();

    render(
      <CarDetailModal carId={1} userRole="viewer" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    await screen.findByText('Несоблюдение требований дорожных знаков');
    fireEvent.click(screen.getByText('Несоблюдение требований дорожных знаков'));

    const dialogs = screen.getAllByRole('dialog');
    const fineDialog = dialogs[dialogs.length - 1];

    expect(within(fineDialog).getByText('18810177261100001003')).toBeInTheDocument();
    expect(within(fineDialog).getByText('24.10.2026, 19:10')).toBeInTheDocument();
    expect(within(fineDialog).getByText('1 500 ₽')).toBeInTheDocument();
    expect(within(fineDialog).getByText('23.12.2026')).toBeInTheDocument();
    expect(within(fineDialog).getByText(/Скидка истекла/i)).toBeInTheDocument();
    expect(fineDialog.textContent).not.toMatch(/-\d+\s*(дн|д\.|day)/i);
  });

  it('displays active discount and no-discount states accurately in FineDetailModal', () => {
    const { rerender } = render(<FineDetailModal fine={SAMPLE_FINES[0]} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('562 ₽')).toBeInTheDocument();
    expect(within(dialog).getByText(/08\.12\.2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('750 ₽')).toBeInTheDocument();

    rerender(<FineDetailModal fine={SAMPLE_FINES[4]} onClose={vi.fn()} />);
    expect(within(screen.getByRole('dialog')).getByText(/Без скидки/i)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('5 000 ₽')).toBeInTheDocument();
  });

  it('renders RentalTimelineModal overdue items with data-status="overdue" and yellow styling, and allows admin payment toggles', async () => {
    const onUpdated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        payment: {
          id: 99,
          rentalId: 10,
          dueDate: '2026-11-11',
          amount: 2400,
          paidAt: '2026-11-21T12:00:00Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <RentalTimelineModal
        carId={1}
        rental={SAMPLE_RENTAL}
        timeline={SAMPLE_TIMELINE}
        userRole="viewer"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const overdueRows = dialog.querySelectorAll('[data-status="overdue"]');
    expect(overdueRows).toHaveLength(2);
    for (const row of overdueRows) {
      expect(row).toHaveAttribute('style', expect.stringContaining('--status-overdue'));
    }
    expect(within(dialog).queryByRole('button', { name: /Отметить оплату/i })).not.toBeInTheDocument();

    rerender(
      <RentalTimelineModal
        carId={1}
        rental={SAMPLE_RENTAL}
        timeline={SAMPLE_TIMELINE}
        userRole="admin"
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const payButtons = within(dialog).getAllByRole('button', { name: 'Отметить оплату' });
    expect(payButtons).toHaveLength(3); // 2 overdue + 1 upcoming
    fireEvent.click(payButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/cars/1/rental/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: '2026-11-11', paid: true }),
      });
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(dialog.querySelectorAll('[data-status="overdue"]')).toHaveLength(1);
    });
  });

  it('prevents closing RentalTimelineModal via Escape or backdrop while payment toggle is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();

    render(
      <RentalTimelineModal
        carId={1}
        rental={SAMPLE_RENTAL}
        timeline={SAMPLE_TIMELINE}
        userRole="admin"
        onClose={onClose}
        onUpdated={vi.fn()}
      />,
    );

    const payButtons = screen.getAllByRole('button', { name: 'Отметить оплату' });
    fireEvent.click(payButtons[0]);

    const closeBtn = screen.getByRole('button', { name: 'Закрыть' });
    expect(closeBtn).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        payment: {
          id: 99,
          rentalId: 10,
          dueDate: '2026-11-11',
          amount: 2400,
          paidAt: '2026-11-21T12:00:00Z',
        },
      }),
    });

    await waitFor(() => {
      expect(closeBtn).not.toBeDisabled();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens ServiceHistoryModal and ServiceDetailModal showing date, mileage, parts with SKU and "—" when omitted, and total sum', () => {
    const onSelectRecord = vi.fn();
    const { rerender } = render(
      <ServiceHistoryModal
        records={SAMPLE_MAINTENANCE}
        onSelectRecord={onSelectRecord}
        onClose={vi.fn()}
      />,
    );

    const historyDialog = screen.getByRole('dialog');
    expect(
      within(historyDialog).getByText('ТО-140: замена масла и фильтров'),
    ).toBeInTheDocument();
    expect(within(historyDialog).getByText('03.11.2026')).toBeInTheDocument();
    expect(within(historyDialog).getByText('Шиномонтаж сезонный')).toBeInTheDocument();
    expect(within(historyDialog).getByText('15.10.2026')).toBeInTheDocument();

    fireEvent.click(within(historyDialog).getByText('ТО-140: замена масла и фильтров'));
    expect(onSelectRecord).toHaveBeenCalledWith(SAMPLE_MAINTENANCE[0]);

    rerender(<ServiceDetailModal record={SAMPLE_MAINTENANCE[0]} onClose={vi.fn()} />);

    const detailDialog = screen.getByRole('dialog');
    expect(within(detailDialog).getByText('03.11.2026')).toBeInTheDocument();
    expect(within(detailDialog).getByText('140 000 км')).toBeInTheDocument();
    expect(within(detailDialog).getByText('Масло моторное 5W-30 (4 л)')).toBeInTheDocument();
    expect(within(detailDialog).getByText('OIL-5W30-4L')).toBeInTheDocument();
    expect(within(detailDialog).getByText('Расходники и очиститель')).toBeInTheDocument();
    expect(within(detailDialog).getByText('—')).toBeInTheDocument();
    expect(within(detailDialog).getByText('2 800 ₽')).toBeInTheDocument();
    expect(within(detailDialog).getByText('7 400 ₽')).toBeInTheDocument();
  });

  it('shows «Управление» link for admin and hides it for viewer', async () => {
    stubCarDetailFetch();

    const { rerender } = render(
      <CarDetailModal carId={1} userRole="viewer" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    const viewerDialog = await screen.findByRole('dialog');
    await within(viewerDialog).findByText('Kia Rio');
    expect(within(viewerDialog).queryByRole('link', { name: /Управление/i })).not.toBeInTheDocument();

    rerender(
      <CarDetailModal carId={1} userRole="admin" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    const adminLink = await within(screen.getByRole('dialog')).findByRole('link', {
      name: /Управление/i,
    });
    expect(adminLink).toHaveAttribute('href', '/cars/1/manage');
  });

  it('wires DashboardClient card click to CarDetailModal and opens ServiceHistoryModal from it', async () => {
    stubCarDetailFetch();

    render(
      <DashboardClient
        initialCars={[
          {
            id: 1,
            plate: 'А123ВС 777',
            brand: 'Kia',
            model: 'Rio',
            status: 'in_rent',
            mileage: 142500,
            unpaidFinesCount: 4,
          },
        ]}
        userRole="admin"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /А123ВС 777/ }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Иванов Алексей Сергеевич');

    fireEvent.click(within(dialog).getByRole('button', { name: /История ремонта/i }));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    expect(
      within(dialogs[1]).getByText('ТО-140: замена масла и фильтров'),
    ).toBeInTheDocument();
  });

  it('calls onSelectFine when clicking a fine row inside FinesListModal', () => {
    const onSelectFine = vi.fn();
    render(
      <FinesListModal fines={SAMPLE_FINES} onSelectFine={onSelectFine} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('Нарушение правил остановки и стоянки'));
    expect(onSelectFine).toHaveBeenCalledWith(SAMPLE_FINES[4]);
  });

  it('shows inline error with retry when loading CarDetailModal fails and recovers on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Ошибка загрузки карточки' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ car: SAMPLE_CAR_DETAIL }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CarDetailModal carId={1} userRole="viewer" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Ошибка загрузки карточки');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Kia Rio')).toBeInTheDocument();
  });

  it('renders empty state when RentalTimelineModal has no rental and handles nested Escape from 3rd modal', async () => {
    const { unmount } = render(
      <RentalTimelineModal
        carId={1}
        rental={null}
        timeline={[]}
        userRole="admin"
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Аренда для этой машины не настроена')).toBeInTheDocument();
    unmount();

    stubCarDetailFetch();
    render(
      <CarDetailModal carId={1} userRole="viewer" onClose={vi.fn()} onUpdated={vi.fn()} />,
    );

    const carDialog = await screen.findByRole('dialog');
    fireEvent.click(within(carDialog).getByRole('button', { name: 'Посмотреть все (5)' }));
    const finesDialog = screen.getAllByRole('dialog')[1];
    fireEvent.click(within(finesDialog).getByText('Нарушение правил остановки и стоянки'));

    expect(screen.getAllByRole('dialog')).toHaveLength(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
