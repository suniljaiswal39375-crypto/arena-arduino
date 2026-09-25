'use client';

import { useI18n } from '@/lib/i18n/client';
import { LanguageSwitch } from './LanguageSwitch';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { Cpu } from 'lucide-react';

const LINKS = [
  { href: '/builder', label: 'builder' },
  { href: '/missions', label: 'missions' },
  { href: '/showcase', label: 'showcase' },
  { href: '/chaos', label: 'chaos' },
  { href: '/parts', label: 'components' },
  { href: '/skills', label: 'skills' },
  { href: '/docs', label: 'docs' },
  { href: '/pricing', label: 'pricing' },
  { href: '/classrooms', label: 'classrooms' },
] as const;

export function SiteHeader() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  return (
    <header lang={locale} className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-2 sm:gap-4 sm:px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Cpu size={18} className="text-[var(--color-accent)]" />
          {PRODUCT_NAME}
        </Link>
        <nav aria-label={t('mainNav')} className="flex items-center min-w-0 flex-1 gap-1 overflow-x-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href || pathname.startsWith(`${l.href}/`) ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                pathname === l.href || pathname.startsWith(`${l.href}/`)
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]',
              )}
            >
              {t(l.label)}
            </Link>
          ))}
        </nav>
        <LanguageSwitch />
      </div>
      {locale === 'hi' && <p lang="hi" className="mx-auto max-w-[1400px] px-4 pb-2 text-xs text-[var(--color-text-dim)]">{t('partial')}</p>}
    </header>
  );
}
