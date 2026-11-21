import { createHash } from 'node:crypto';
import type { FineStatus } from '@/db/schema';
import type { ExternalFine, FinesProvider } from './provider';

const BASE_UTC_MS = Date.UTC(2026, 10, 21);
const DAY_MS = 86_400_000;

const FINE_TEMPLATES: ReadonlyArray<{
  amount: number;
  discountable: boolean;
  description: string;
}> = [
  {
    amount: 750,
    discountable: true,
    description: 'Превышение скорости на 20–40 км/ч (ст. 12.9 ч. 2 КоАП)',
  },
  {
    amount: 1500,
    discountable: true,
    description: 'Несоблюдение требований дорожных знаков или разметки (ст. 12.16 ч. 1 КоАП)',
  },
  {
    amount: 3000,
    discountable: true,
    description: 'Движение по полосе для маршрутных транспортных средств (ст. 12.17 ч. 1.2 КоАП)',
  },
  {
    amount: 2500,
    discountable: true,
    description: 'Проезд на запрещающий сигнал светофора (ст. 12.12 ч. 1 КоАП)',
  },
  {
    amount: 500,
    discountable: true,
    description: 'Нарушение правил применения ремней безопасности (ст. 12.6 КоАП)',
  },
  {
    amount: 5000,
    discountable: false,
    description: 'Остановка или стоянка на местах для инвалидов (ст. 12.19 ч. 2 КоАП)',
  },
  {
    amount: 3000,
    discountable: false,
    description: 'Неоплата размещения транспортного средства на платной парковке (МАДИ)',
  },
];

function isoDateOffset(baseMs: number, days: number): string {
  return new Date(baseMs + days * DAY_MS).toISOString().slice(0, 10);
}

/** Deterministic mock provider generating 1–5 Russian traffic fines per vehicle plate. */
export class MockFinesProvider implements FinesProvider {
  async fetchFinesByPlate(plate: string, stsNumber?: string | null): Promise<ExternalFine[]> {
    void stsNumber;
    const normalized = plate.trim().toUpperCase();
    const rootDigest = createHash('sha256').update(normalized).digest();
    const count = 1 + (rootDigest[0] % 5);

    const results: ExternalFine[] = [];
    for (let i = 0; i < count; i += 1) {
      const digest = createHash('sha256').update(`${normalized}:${i}`).digest();
      const suffix = Array.from(digest.subarray(0, 6), (b) => String(b % 100).padStart(2, '0')).join('');
      const resolutionNumber = `18810177${suffix}`;

      const template = FINE_TEMPLATES[digest[6] % FINE_TEMPLATES.length];
      const daysAgo = 2 + (digest[7] % 45);
      const hour = String(7 + (digest[8] % 15)).padStart(2, '0');
      const minute = String(digest[9] % 60).padStart(2, '0');

      const violatedMs = BASE_UTC_MS - daysAgo * DAY_MS;
      const violatedDate = new Date(violatedMs).toISOString().slice(0, 10);
      const status: FineStatus = digest[10] % 4 === 0 ? 'paid' : 'unpaid';

      results.push({
        resolutionNumber,
        violatedAt: `${violatedDate}T${hour}:${minute}:00+03:00`,
        amount: template.amount,
        discountAmount: template.discountable ? Math.floor(template.amount * 0.75) : null,
        discountDeadline: template.discountable ? isoDateOffset(violatedMs, 30) : null,
        paymentDeadline: isoDateOffset(violatedMs, 70),
        description: template.description,
        status,
      });
    }

    return results;
  }
}
