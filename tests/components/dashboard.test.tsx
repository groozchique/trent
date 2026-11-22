import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CarSummaryDto } from '@/lib/validation';
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

  it('renders plate, brand icon, model, Russian status, formatted mileage, and unpaid fines count', () => {
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
    expect(within(cardButton).getByText('2')).toBeInTheDocument();

    fireEvent.click(cardButton);
    expect(onSelect).toHaveBeenCalledWith(1);
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
});
