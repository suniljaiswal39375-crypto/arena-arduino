'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { Cpu } from 'lucide-react';

const LINKS = [
  { href: '/builder', label: 'Builder' },
  { href: '/missions', label: 'Missions' },
  { href: '/showcase', label: 'Showcase' },
  { href: '/chaos', label: 'Chaos Lab' },
  { href: '/parts', label: 'Components' },
  { href: '/skills', label: 'Skills' },
  { href: '/docs', label: 'Docs' },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Cpu size={18} className="text-[var(--color-accent)]" />
          {PRODUCT_NAME}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto">
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
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
