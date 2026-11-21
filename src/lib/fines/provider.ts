import { MockFinesProvider } from './mock-provider';
import type { FineStatus } from '@/db/schema';

export interface ExternalFine {
  resolutionNumber: string;
  violatedAt: string;
  amount: number;
  discountAmount: number | null;
  discountDeadline: string | null;
  paymentDeadline: string;
  description: string;
  status: FineStatus;
}

export interface FinesProvider {
  fetchFinesByPlate(plate: string): Promise<ExternalFine[]>;
}

/** Resolve active fines provider (defaults to deterministic MockFinesProvider). */
export function getFinesProvider(): FinesProvider {
  const configured = process.env.FINES_PROVIDER?.trim().toLowerCase();
  if (!configured || configured === 'mock') {
    return new MockFinesProvider();
  }
  throw new Error(`Провайдер штрафов "${configured}" не настроен`);
}
