'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import type { CarStatus } from '@/db/schema';
import { readApiError } from '@/lib/api-client';
import { SHOW_FINES } from '@/lib/features';
import { createCarSchema, type CarDetailDto, type CarSummaryDto } from '@/lib/validation';
import { KNOWN_BRANDS } from '../BrandIcon';
import { FeedbackBanner, type FeedbackState } from '../FeedbackBanner';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BTN_CLASS,
  SECONDARY_BTN_CLASS,
  parseRequiredNumber,
} from './shared';

const CAR_STATUS_OPTIONS: Array<{ value: CarStatus; label: string }> = [
  { value: 'in_rent', label: 'В аренде' },
  { value: 'in_repair', label: 'В ремонте' },
  { value: 'available', label: 'Не в аренде' },
];

/** General vehicle info editor and two-step inline delete confirmation. */
export function GeneralInfoTab({
  car,
  onCarUpdated,
}: {
  car: CarDetailDto;
  onCarUpdated: (patch?: (prev: CarDetailDto) => CarDetailDto) => Promise<void>;
}) {
  const router = useRouter();
  const [plate, setPlate] = useState(car.plate);
  const [stsNumber, setStsNumber] = useState(car.stsNumber ?? '');
  const [brand, setBrand] = useState(car.brand);
  const [model, setModel] = useState(car.model);
  const [status, setStatus] = useState<CarStatus>(car.status);
  const [mileage, setMileage] = useState(String(car.mileage));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setPlate(car.plate);
    setStsNumber(car.stsNumber ?? '');
    setBrand(car.brand);
    setModel(car.model);
    setStatus(car.status);
    setMileage(String(car.mileage));
  }, [car.id, car.plate, car.stsNumber, car.brand, car.model, car.status, car.mileage]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const parsed = createCarSchema.safeParse({
      plate,
      brand,
      model,
      status,
      mileage: parseRequiredNumber(mileage),
      stsNumber,
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные автомобиля',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/cars/${car.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось обновить автомобиль'),
        });
        return;
      }

      const data = (await response.json()) as { car?: CarSummaryDto };
      await onCarUpdated((prev) =>
        data.car
          ? { ...prev, ...data.car }
          : { ...prev, ...parsed.data, stsNumber: parsed.data.stsNumber ?? null },
      );
      setFeedback({ kind: 'success', message: 'Изменения сохранены' });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить изменения. Проверьте сеть' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/cars/${car.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setDeleteError(await readApiError(response, 'Не удалось удалить автомобиль'));
        setDeleting(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setDeleteError('Не удалось удалить машину. Проверьте сеть');
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} noValidate className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Основные данные
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="manage-car-plate" className={LABEL_CLASS}>
              Гос. номер
            </label>
            <input
              id="manage-car-plate"
              name="plate"
              type="text"
              value={plate}
              onChange={(event) => setPlate(event.target.value)}
              disabled={busy}
              placeholder="А123ВС 777"
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-sts" className={LABEL_CLASS}>
              Номер СТС
            </label>
            <input
              id="manage-car-sts"
              name="stsNumber"
              type="text"
              value={stsNumber}
              onChange={(event) => setStsNumber(event.target.value)}
              disabled={busy}
              placeholder="99 01 123456"
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-status" className={LABEL_CLASS}>
              Статус
            </label>
            <select
              id="manage-car-status"
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as CarStatus)}
              disabled={busy}
              className={INPUT_CLASS}
            >
              {CAR_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="manage-car-mileage" className={LABEL_CLASS}>
              Пробег, км
            </label>
            <input
              id="manage-car-mileage"
              name="mileage"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              disabled={busy}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="manage-car-brand" className={LABEL_CLASS}>
              Марка
            </label>
            <input
              id="manage-car-brand"
              name="brand"
              type="text"
              list="manage-car-brand-options"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              disabled={busy}
              placeholder="Kia"
              className={INPUT_CLASS}
            />
            <datalist id="manage-car-brand-options">
              {KNOWN_BRANDS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="manage-car-model" className={LABEL_CLASS}>
              Модель
            </label>
            <input
              id="manage-car-model"
              name="model"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={busy}
              placeholder="Rio"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <FeedbackBanner feedback={feedback} />

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={PRIMARY_BTN_CLASS}>
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>

      <section
        aria-label="Удаление машины"
        className="space-y-3 border-t border-[var(--border-subtle)] pt-5"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Удаление машины
          </h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {SHOW_FINES
              ? 'Машина и все записи по аренде, штрафам и ТО удалятся навсегда.'
              : 'Машина и все записи по аренде и ТО удалятся навсегда.'}
          </p>
        </div>

        {!confirmDelete ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            style={{
              backgroundColor: 'var(--status-repair-bg)',
              borderColor: 'var(--status-repair-border)',
              color: 'var(--status-repair-text)',
            }}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Удалить машину</span>
          </button>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--status-repair-bg)',
              borderColor: 'var(--status-repair-border)',
            }}
            className="space-y-3 rounded-xl border p-3.5"
          >
            <p
              style={{ color: 'var(--status-repair-text)' }}
              className="text-xs font-medium sm:text-sm"
            >
              Удалить {car.plate}? Отменить это нельзя.
            </p>
            <FeedbackBanner
              feedback={deleteError ? { kind: 'error', message: deleteError } : null}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete(false);
                }}
                className={SECONDARY_BTN_CLASS}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  void handleDelete();
                }}
                style={{
                  backgroundColor: 'var(--status-danger)',
                  color: 'var(--status-danger-fg)',
                }}
                className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
