import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/components/TopBar';
import { getCurrentUser } from '@/lib/auth/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Таксопарк — Управление автопарком',
  description: 'Админ-панель учёта автомобилей такси, аренды, штрафов и ремонта',
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('taxi_theme');var d=t==='light'||t==='dark'?t:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <TopBar user={user} />
        {children}
      </body>
    </html>
  );
}
