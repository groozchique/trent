'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { CarStatus } from '@/db/schema';
import { createCarSchema } from '@/lib/validation';
import { KNOWN_BRANDS } from './BrandIcon';

const STATUS_OPTIONS: Array<{ value: CarStatus; label: string }> = [
  { value: 'available', label: 'Не в аренде' },
  { value: 'in_rent', label: 'В аренде' },
  { value: 'in_repair', label: 'На ремонте' },
];

function AddCarModalBody({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const plateInputRef = useRef<HTMLInputElement>(null);
  const [plate, setPlate] = useState('');
  const [stsNumber, setStsNumber] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<CarStatus>('available');
  const [mileage, setMileage] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    plateInputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedMileage = mileage.trim();
    const parsedMileage = trimmedMileage === '' ? undefined : Number(trimmedMileage);
    const trimmedSts = stsNumber.trim();
    const parsed = createCarSchema.safeParse({
      plate,
      brand,
      model,
      status,
      mileage: parsedMileage,
      ...(trimmedSts !== '' ? { stsNumber: trimmedSts } : {}),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Некорректные данные автомобиля');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/cars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Не удалось добавить машину');
        return;
      }

      onCreated();
      onClose();
    } catch {
      setError('Не удалось сохранить машину. Проверьте сеть');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="add-car-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-car-modal-title"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-lg sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
          <h2
            id="add-car-modal-title"
            className="text-base font-semibold tracking-tight text-[var(--text-primary)] sm:text-lg"
          >
            Новая машина
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Закрыть"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3.5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="add-car-plate"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Гос. номер
              </label>
              <input
                ref={plateInputRef}
                id="add-car-plate"
                name="plate"
                type="text"
                value={plate}
                onChange={(event) => setPlate(event.target.value)}
                disabled={submitting}
                placeholder="А123ВС 777"
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="add-car-sts"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Номер СТС
              </label>
              <input
                id="add-car-sts"
                name="stsNumber"
                type="text"
                value={stsNumber}
                onChange={(event) => setStsNumber(event.target.value)}
                disabled={submitting}
                placeholder="99 01 123456"
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 font-mono text-sm text-[var(--text-primary)] tabular-nums placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="add-car-brand"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Марка
              </label>
              <input
                id="add-car-brand"
                name="brand"
                type="text"
                list="add-car-brand-options"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                disabled={submitting}
                placeholder="Kia"
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
              />
              <datalist id="add-car-brand-options">
                {KNOWN_BRANDS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="add-car-model"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Модель
              </label>
              <input
                id="add-car-model"
                name="model"
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={submitting}
                placeholder="Rio"
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="add-car-status"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Статус
              </label>
              <select
                id="add-car-status"
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as CarStatus)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--border-strong)] disabled:opacity-60"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="add-car-mileage"
                className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Пробег, км
              </label>
              <input
                id="add-car-mileage"
                name="mileage"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={mileage}
                onChange={(event) => setMileage(event.target.value)}
                disabled={submitting}
                placeholder="0"
                className="h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] tabular-nums placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="rounded-lg border px-3 py-2 text-xs font-medium"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Accessible admin modal/bottom-sheet for adding a new vehicle via POST /api/cars. */
export function AddCarModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  if (!open) return null;
  return <AddCarModalBody onClose={onClose} onCreated={onCreated} />;
}
