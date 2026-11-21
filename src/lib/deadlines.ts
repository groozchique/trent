import { CAR_DOCUMENT_TYPES, type CarDocumentRow, type CarDocumentType } from '@/db/schema';
import { diffUtcDays } from '@/lib/format';

export type DeadlineState = 'ok' | 'warning' | 'expired';

export const CAR_DOCUMENT_LABELS: Record<CarDocumentType, string> = {
  osago: 'ОСАГО',
  tech_inspection: 'Техосмотр',
  taxi_license: 'Лицензия такси',
  kasko: 'КАСКО',
};

export type CarDeadlineSummary = {
  status: DeadlineState;
  urgentDeadlinesCount: number;
  expiredCount: number;
  warningCount: number;
  serviceMileage: {
    target: number;
    mileageLeft: number;
    status: DeadlineState;
  } | null;
  serviceDate: {
    target: string;
    daysLeft: number;
    status: DeadlineState;
  } | null;
  documents: Array<{
    type: CarDocumentType;
    label: string;
    expiresAt: string;
    daysLeft: number;
    status: DeadlineState;
  }>;
};

/** Classify a date deadline relative to `todayIso`: `<0` expired, `0..14` warning, `>14` ok. */
export function evaluateDateDeadline(
  dateIso: string,
  todayIso: string,
): { status: DeadlineState; daysLeft: number } {
  const daysLeft = diffUtcDays(dateIso, todayIso);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= 14) return { status: 'warning', daysLeft };
  return { status: 'ok', daysLeft };
}

/** Classify a mileage service threshold: `<=0` km left expired, `1..1000` warning, `>1000` ok. */
export function evaluateMileageDeadline(
  currentMileage: number,
  targetMileage: number,
): { status: DeadlineState; mileageLeft: number } {
  const mileageLeft = targetMileage - currentMileage;
  if (mileageLeft <= 0) return { status: 'expired', mileageLeft };
  if (mileageLeft <= 1000) return { status: 'warning', mileageLeft };
  return { status: 'ok', mileageLeft };
}

/** Evaluate all document and scheduled maintenance deadlines for a vehicle. */
export function evaluateCarDeadlines(
  car: {
    mileage: number;
    nextServiceMileage: number | null;
    nextServiceDate: string | null;
  },
  documents: Array<Pick<CarDocumentRow, 'type' | 'expiresAt'>>,
  todayIso: string,
): CarDeadlineSummary {
  let expiredCount = 0;
  let warningCount = 0;

  const track = (state: DeadlineState) => {
    if (state === 'expired') expiredCount += 1;
    else if (state === 'warning') warningCount += 1;
  };

  let serviceMileage: CarDeadlineSummary['serviceMileage'] = null;
  if (car.nextServiceMileage !== null) {
    const evalMileage = evaluateMileageDeadline(car.mileage, car.nextServiceMileage);
    track(evalMileage.status);
    serviceMileage = { target: car.nextServiceMileage, ...evalMileage };
  }

  let serviceDate: CarDeadlineSummary['serviceDate'] = null;
  if (car.nextServiceDate !== null) {
    const evalDate = evaluateDateDeadline(car.nextServiceDate, todayIso);
    track(evalDate.status);
    serviceDate = { target: car.nextServiceDate, ...evalDate };
  }

  const order = new Map<CarDocumentType, number>(CAR_DOCUMENT_TYPES.map((t, i) => [t, i]));
  const evaluatedDocs = [...documents]
    .sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99))
    .map((doc) => {
      const evalDate = evaluateDateDeadline(doc.expiresAt, todayIso);
      track(evalDate.status);
      return {
        type: doc.type,
        label: CAR_DOCUMENT_LABELS[doc.type],
        expiresAt: doc.expiresAt,
        ...evalDate,
      };
    });

  const status: DeadlineState =
    expiredCount > 0 ? 'expired' : warningCount > 0 ? 'warning' : 'ok';

  return {
    status,
    urgentDeadlinesCount: expiredCount + warningCount,
    expiredCount,
    warningCount,
    serviceMileage,
    serviceDate,
    documents: evaluatedDocs,
  };
}
