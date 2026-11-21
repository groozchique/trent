import type { ReactNode } from 'react';

type KnownBrand =
  | 'kia'
  | 'hyundai'
  | 'skoda'
  | 'volkswagen'
  | 'toyota'
  | 'lada'
  | 'geely'
  | 'chery'
  | 'haval';

const BRAND_ALIASES: Record<string, KnownBrand> = {
  kia: 'kia',
  hyundai: 'hyundai',
  skoda: 'skoda',
  škoda: 'skoda',
  volkswagen: 'volkswagen',
  vw: 'volkswagen',
  toyota: 'toyota',
  lada: 'lada',
  geely: 'geely',
  chery: 'chery',
  haval: 'haval',
};

const BRAND_GLYPHS: Record<KnownBrand, () => ReactNode> = {
  kia: () => (
    <>
      <rect x="1.75" y="5.5" width="20.5" height="13" rx="6.5" />
      <path d="M5.5 9.25v5.5m0-2.75 2.75-2.75m-2.75 2.75 2.75 2.75M11.25 9.25v5.5M14.25 14.75l2.5-5.5 2.5 5.5m-4-1.6h3" />
    </>
  ),
  hyundai: () => (
    <>
      <ellipse cx="12" cy="12" rx="9.75" ry="6.25" />
      <path d="M8.75 8.5 7 15.5m10-7-1.75 7M7.9 12.2l8.2-.4" />
    </>
  ),
  skoda: () => (
    <>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M6.75 13.75c2.25-3 5.75-4.25 10.25-3.5l-2.5 2.25h3M9 14.75c2-1 4.25-1 6.5-.25" />
    </>
  ),
  volkswagen: () => (
    <>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M8.5 6.25 12 11.75l3.5-5.5M7 10.25 9.75 17 12 12.75 14.25 17 17 10.25" />
    </>
  ),
  toyota: () => (
    <>
      <ellipse cx="12" cy="12" rx="9.75" ry="6.75" />
      <ellipse cx="12" cy="12" rx="2.75" ry="6.25" />
      <ellipse cx="12" cy="9.5" rx="6" ry="2.4" />
    </>
  ),
  lada: () => (
    <>
      <ellipse cx="12" cy="12" rx="9.75" ry="6.25" />
      <path d="M12 7v9.5M12 7.25c2.75 1.5 3.5 4.25 2.25 6.75l-5.5.25c-.25-2.5 1-4.75 3.25-7Z" />
    </>
  ),
  geely: () => (
    <>
      <path d="M5 5.75c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5V12c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5.75Z" />
      <path d="M12 4.5v16M5.5 10.5h13M8.5 14.5h7" />
    </>
  ),
  chery: () => (
    <>
      <ellipse cx="12" cy="12" rx="9.75" ry="6.25" />
      <path d="M8 15.25 12 7.5l4 7.75M7.25 12.25h9.5" />
    </>
  ),
  haval: () => (
    <>
      <path d="M4.5 7.5 7 5h10l2.5 2.5v9L17 19H7l-2.5-2.5v-9Z" />
      <path d="M8.5 8.5v7m7-7v7m-7-3.5h7" />
    </>
  ),
};

function FallbackCarGlyph() {
  return (
    <>
      <path d="M4.75 15H3.5a1 1 0 0 1-1-1v-2.25c0-.46.27-.88.69-1.07l1.95-.88 2.25-2.9A2 2 0 0 1 9 6.15h5.5a2 2 0 0 1 1.58.77l2.12 2.73 2.1.68c.56.18.95.7.95 1.29V14a1 1 0 0 1-1 1h-1.25M8.75 15h6.5" />
      <circle cx="6.75" cy="15.25" r="2" />
      <circle cx="17.25" cy="15.25" r="2" />
    </>
  );
}

/** Monochrome geometric car brand mark with accessible Russian label and sedan fallback. */
export function BrandIcon({ brand, className }: { brand: string; className?: string }) {
  const displayBrand = brand.trim();
  const brandKey = BRAND_ALIASES[displayBrand.toLowerCase()];
  const ariaLabel = brandKey
    ? `Логотип ${displayBrand}`
    : `Автомобиль ${displayBrand || 'неизвестной марки'}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ariaLabel}
      data-brand={brandKey ?? 'fallback'}
      className={className ?? 'h-5 w-5 shrink-0'}
    >
      {brandKey ? BRAND_GLYPHS[brandKey]() : <FallbackCarGlyph />}
    </svg>
  );
}
